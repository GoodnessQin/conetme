-- Phase 2 (provider registration and verification) and Phase 3 (requests, offers, acceptance).
-- Business rules live in database functions so the browser cannot bypass them.
-- Run this once in the Supabase SQL editor after migrations 1 to 5.

-- =====================================================================
-- Shared helpers
-- =====================================================================
create or replace function public.guards_bypassed() returns boolean
language sql stable as $$ select coalesce(current_setting('app.bypass_guard', true), '') = 'on' $$;

create or replace function public.can_verify() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('verifier','admin'))
$$;

-- Blocks phone numbers, emails and off-platform contact phrases in free text.
create or replace function public.contains_contact_info(t text) returns boolean
language sql immutable as $$
  select t is not null and (
       regexp_replace(t, '[\s().\-]', '', 'g') ~ '(\+?234|0)?[789][01]\d{8}'
    or t ~ '\d{10,}'
    or t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    or t ~* '(whats\s?app|telegram|call me|text me|dm me|ring me)'
  )
$$;

create or replace function public.rank_score(p_rating numeric, p_dist_km double precision, p_radius int, p_jobs int, p_resp numeric)
returns numeric language sql immutable as $$
  select ((p_rating / 5.0) * 34
       + greatest(0, 1 - p_dist_km / greatest(p_radius, 1)) * 28
       + 22
       + least(p_jobs / 50.0, 1) * 10
       + 6
       + (case when p_jobs < 3 then 4 else 0 end)
       - (1 - p_resp) * 10)::numeric
$$;

create or replace function public.provider_badges(p_provider uuid) returns text[]
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(array_agg(vc.type::text order by vc.type), '{}')
  from public.verification_checks vc
  join public.verification_cases c on c.id = vc.case_id
  where c.provider_id = p_provider and vc.status = 'pass'
$$;

-- =====================================================================
-- Re-create guard triggers so trusted functions can change protected fields
-- =====================================================================
create or replace function public.guard_providers() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.guards_bypassed() then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_staff() then
      new.status := 'draft'; new.level := 0; new.rating_avg := 0; new.rating_count := 0;
      new.jobs_completed := 0; new.response_rate := 1; new.cancellation_count := 0;
      new.no_show_count := 0; new.job_cap_kobo := 10000000;
    end if;
    return new;
  end if;
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_staff() then return new; end if;
  if new.status is distinct from old.status or new.level is distinct from old.level
     or new.rating_avg is distinct from old.rating_avg or new.rating_count is distinct from old.rating_count
     or new.jobs_completed is distinct from old.jobs_completed or new.response_rate is distinct from old.response_rate
     or new.cancellation_count is distinct from old.cancellation_count or new.no_show_count is distinct from old.no_show_count
     or new.job_cap_kobo is distinct from old.job_cap_kobo or new.user_id is distinct from old.user_id then
    raise exception 'protected provider field' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_provider_services() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.guards_bypassed() then return new; end if;
  if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_staff() then
    if tg_op = 'INSERT' then new.status := 'submitted';
    elsif new.status is distinct from old.status then raise exception 'protected field' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_requests() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.guards_bypassed() then return new; end if;
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_staff() then return new; end if;
  if tg_op = 'INSERT' and new.status not in ('draft','open') then
    raise exception 'invalid initial status' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception 'only cancel is allowed' using errcode = '42501';
  end if;
  return new;
end $$;

-- =====================================================================
-- New tables and columns
-- =====================================================================
create table public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;   -- no policies: only security definer functions read it
insert into public.app_secrets (key, value) values ('nin_pepper', encode(extensions.gen_random_bytes(32), 'hex'));

alter table public.provider_private
  add column id_type text check (id_type in ('nin_slip','national_id','drivers_licence','voters_card','passport')),
  add column bank_name text,
  add column bank_account_number text,
  add column bank_account_name text;

create table public.provider_references (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  name text not null,
  phone text not null,
  relationship text not null,
  called_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.provider_references enable row level security;
create policy refs_select on public.provider_references for select to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff());

create policy vdocs_delete_own on public.verification_documents for delete to authenticated
  using (exists (select 1 from public.verification_cases c join public.providers p on p.id = c.provider_id
                 where c.id = case_id and p.user_id = auth.uid() and p.status in ('draft','needs_info')));

insert into public.settings (key, value, description) values
  ('test_payments', 'true', 'TEST MODE: lets customers mark a job as paid without a real payment. Set to false before launch.'),
  ('min_offer_kobo', '50000', 'Smallest offer a provider may send (NGN 500)')
on conflict (key) do nothing;

-- Provider rows: keep the map location in step with the chosen area, cap the radius, grant the provider role.
create or replace function public.sync_provider_location() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.base_area_id is not null then
    select location into new.base_location from public.areas where id = new.base_area_id;
  end if;
  if not public.is_staff() and not public.guards_bypassed() then new.radius_km := least(new.radius_km, 30); end if;
  return new;
end $$;
create trigger providers_zz_location before insert or update on public.providers
for each row execute function public.sync_provider_location();

create or replace function public.on_provider_created() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.user_roles (user_id, role) values (new.user_id, 'provider') on conflict do nothing;
  return new;
end $$;
create trigger providers_role after insert on public.providers
for each row execute function public.on_provider_created();

-- =====================================================================
-- Offers: validation and side effects
-- =====================================================================
create or replace function public.guard_offers() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare cap bigint; minp bigint; r public.requests%rowtype;
begin
  if public.guards_bypassed() then return new; end if;
  select * into r from public.requests where id = new.request_id;
  if r.id is null or r.status not in ('open','offers_received') or (r.expires_at is not null and r.expires_at < now()) then
    raise exception 'This request is no longer open for offers.';
  end if;
  select job_cap_kobo into cap from public.providers where id = new.provider_id;
  select value::text::bigint into minp from public.settings where key = 'min_offer_kobo';
  if new.price_kobo < coalesce(minp, 50000) then raise exception 'The minimum offer is NGN 500.'; end if;
  if new.price_kobo > cap then
    raise exception 'This offer is above your current job value limit. The limit rises as you complete jobs.';
  end if;
  if public.contains_contact_info(new.message) then
    raise exception 'Remove phone numbers, emails and chat app names from your message. Contact details are shared only after payment.';
  end if;
  new.status := 'sent';
  new.expires_at := r.expires_at;
  return new;
end $$;
create trigger offers_guard before insert on public.offers
for each row execute function public.guard_offers();

create or replace function public.after_offer_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform set_config('app.bypass_guard', 'on', true);
  update public.requests set status = 'offers_received' where id = new.request_id and status = 'open';
  update public.request_recipients set responded = true where request_id = new.request_id and provider_id = new.provider_id;
  insert into public.notifications (user_id, type, payload)
  select r.customer_id, 'offer_received', jsonb_build_object('request_id', r.id, 'offer_id', new.id)
  from public.requests r where r.id = new.request_id;
  perform set_config('app.bypass_guard', 'off', true);
  return new;
end $$;
create trigger offers_after_insert after insert on public.offers
for each row execute function public.after_offer_insert();

-- =====================================================================
-- Provider registration functions
-- =====================================================================
create or replace function public.ensure_verification_case() returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id(); cid uuid;
begin
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  select id into cid from public.verification_cases where provider_id = pid order by created_at desc limit 1;
  if cid is null then
    insert into public.verification_cases (provider_id) values (pid) returning id into cid;
  end if;
  return cid;
end $$;

create or replace function public.save_nin(p_nin text, p_id_type text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id(); pepper text; h text;
begin
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  if (select status from public.providers where id = pid) not in ('draft','needs_info') then
    raise exception 'Your application is already under review.'; end if;
  if p_nin !~ '^\d{11}$' then raise exception 'A National Identification Number has exactly 11 digits.'; end if;
  select value into pepper from public.app_secrets where key = 'nin_pepper';
  h := encode(extensions.digest(p_nin || pepper, 'sha256'), 'hex');
  begin
    insert into public.provider_private (provider_id, nin_hash, nin_last4, id_type)
    values (pid, h, right(p_nin, 4), p_id_type)
    on conflict (provider_id) do update set nin_hash = excluded.nin_hash, nin_last4 = excluded.nin_last4, id_type = excluded.id_type;
  exception when unique_violation then
    raise exception 'This NIN is already linked to another ConnectMe account. If this is a mistake, contact support.';
  end;
end $$;

create or replace function public.save_bank(p_bank text, p_number text, p_account_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id();
begin
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  if (select status from public.providers where id = pid) not in ('draft','needs_info') then
    raise exception 'Your application is already under review.'; end if;
  if p_number !~ '^\d{10}$' then raise exception 'A Nigerian bank account number has exactly 10 digits.'; end if;
  if length(trim(coalesce(p_account_name, ''))) < 3 then raise exception 'Enter the account name exactly as your bank shows it.'; end if;
  begin
    insert into public.provider_private (provider_id, bank_name, bank_account_number, bank_account_name, bank_account_hash)
    values (pid, p_bank, p_number, trim(p_account_name), encode(extensions.digest(p_number, 'sha256'), 'hex'))
    on conflict (provider_id) do update set bank_name = excluded.bank_name, bank_account_number = excluded.bank_account_number,
      bank_account_name = excluded.bank_account_name, bank_account_hash = excluded.bank_account_hash;
  exception when unique_violation then
    raise exception 'This bank account is already registered to another provider.';
  end;
end $$;

create or replace function public.normalize_ng_phone(p text) returns text
language sql immutable as $$
  select case
    when regexp_replace(p, '[\s().\-]', '', 'g') ~ '^(\+?234|0)?[789][01]\d{8}$'
    then '+234' || right(regexp_replace(p, '[\s().\-]', '', 'g'), 10)
    else null end
$$;

create or replace function public.save_guarantor(p_name text, p_phone text, p_relationship text, p_address text, p_years int)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id(); ph text := public.normalize_ng_phone(p_phone); own text;
begin
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  if (select status from public.providers where id = pid) not in ('draft','needs_info') then
    raise exception 'Your application is already under review.'; end if;
  if ph is null then raise exception 'Enter a valid Nigerian phone number for your guarantor.'; end if;
  select '+' || phone into own from public.profiles where id = auth.uid();
  if regexp_replace(coalesce(own,''), '^\+\+', '+') = ph or own = ph then
    raise exception 'Your guarantor must be a different person with a different phone number.'; end if;
  if length(trim(coalesce(p_name,''))) < 5 then raise exception 'Enter your guarantor''s full name.'; end if;
  insert into public.guarantors (provider_id, name, phone, relationship, address, years_known, declaration_version)
  values (pid, trim(p_name), ph, p_relationship, p_address, p_years, 'v1')
  on conflict (provider_id) do update set name = excluded.name, phone = excluded.phone, relationship = excluded.relationship,
    address = excluded.address, years_known = excluded.years_known, confirmed_at = null;
end $$;

create or replace function public.save_references(p_refs jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id(); r jsonb; ph text; seen text[] := '{}'; gphone text;
begin
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  if (select status from public.providers where id = pid) not in ('draft','needs_info') then
    raise exception 'Your application is already under review.'; end if;
  if jsonb_array_length(p_refs) < 2 then raise exception 'Add two people we can call about your work.'; end if;
  select phone into gphone from public.guarantors where provider_id = pid;
  delete from public.provider_references where provider_id = pid;
  for r in select * from jsonb_array_elements(p_refs) loop
    ph := public.normalize_ng_phone(r->>'phone');
    if ph is null then raise exception 'Enter a valid Nigerian phone number for %.', coalesce(r->>'name','each reference'); end if;
    if ph = any(seen) or ph = gphone then raise exception 'Each reference needs a different phone number, and none may be your guarantor.'; end if;
    seen := seen || ph;
    insert into public.provider_references (provider_id, name, phone, relationship)
    values (pid, trim(r->>'name'), ph, r->>'relationship');
  end loop;
end $$;

create or replace function public.my_verification_progress() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id(); p public.providers%rowtype; pp public.provider_private%rowtype; c public.verification_cases%rowtype;
begin
  if pid is null then return jsonb_build_object('has_provider', false); end if;
  select * into p from public.providers where id = pid;
  select * into pp from public.provider_private where provider_id = pid;
  select * into c from public.verification_cases where provider_id = pid order by created_at desc limit 1;
  return jsonb_build_object(
    'has_provider', true, 'status', p.status, 'level', p.level, 'case_id', c.id,
    'decision_note', c.rejection_reason, 'submitted_at', c.submitted_at,
    'profile', (p.display_name is not null and p.base_area_id is not null and p.years_experience is not null and coalesce(length(p.bio), 0) >= 20),
    'services', (select count(*) from public.provider_services where provider_id = pid),
    'nin', pp.nin_hash is not null, 'nin_last4', pp.nin_last4,
    'bank', pp.bank_account_number is not null, 'bank_name', pp.bank_name,
    'bank_last4', right(coalesce(pp.bank_account_number, ''), 4),
    'id_photo', exists (select 1 from public.verification_documents d where d.case_id = c.id and d.type = 'id_photo'),
    'selfie', exists (select 1 from public.verification_documents d where d.case_id = c.id and d.type = 'selfie'),
    'address_doc', exists (select 1 from public.verification_documents d where d.case_id = c.id and d.type = 'address_proof'),
    'credentials', (select count(*) from public.verification_documents d where d.case_id = c.id and d.type = 'credential'),
    'guarantor', exists (select 1 from public.guarantors g where g.provider_id = pid),
    'portfolio', (select count(*) from public.portfolio_items where provider_id = pid),
    'references', (select count(*) from public.provider_references where provider_id = pid),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object('type', vc.type, 'status', vc.status) order by vc.type), '[]')
               from public.verification_checks vc where vc.case_id = c.id)
  );
end $$;

create or replace function public.submit_verification(p_consents jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id(); pr jsonb; missing text[] := '{}'; cid uuid; t text;
begin
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  if (select status from public.providers where id = pid) not in ('draft','needs_info') then
    raise exception 'Your application has already been submitted.'; end if;
  pr := public.my_verification_progress();
  if not (pr->>'profile')::boolean then missing := missing || 'your profile'; end if;
  if (pr->>'services')::int < 1 then missing := missing || 'at least one service'; end if;
  if not (pr->>'nin')::boolean or not (pr->>'id_photo')::boolean then missing := missing || 'identity (NIN and ID photo)'; end if;
  if not (pr->>'selfie')::boolean then missing := missing || 'your selfie'; end if;
  if not (pr->>'bank')::boolean then missing := missing || 'your bank account'; end if;
  if not (pr->>'guarantor')::boolean then missing := missing || 'your guarantor'; end if;
  if not (pr->>'address_doc')::boolean then missing := missing || 'proof of address'; end if;
  if (pr->>'credentials')::int < 1 then missing := missing || 'work credentials'; end if;
  if (pr->>'portfolio')::int < 3 then missing := missing || 'three photos of past work'; end if;
  if (pr->>'references')::int < 2 then missing := missing || 'two references'; end if;
  foreach t in array array['terms','privacy','safety'] loop
    if coalesce(p_consents->>t, '') <> 'true' then missing := missing || ('your agreement to the ' || t || ' statement'); end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'Complete these before submitting: %', array_to_string(missing, ', ');
  end if;
  cid := (pr->>'case_id')::uuid;
  perform set_config('app.bypass_guard', 'on', true);
  update public.providers set status = 'submitted' where id = pid;
  update public.verification_cases
     set status = 'submitted', submitted_at = now(), rejection_reason = null,
         checklist = jsonb_build_object('consents', p_consents, 'consented_at', now())
   where id = cid;
  insert into public.verification_checks (case_id, type)
  select cid, unnest(enum_range(null::check_type)) on conflict (case_id, type) do nothing;
  update public.verification_checks set status = 'not_checked' where case_id = cid and status = 'fail';
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Admin review functions
-- =====================================================================
create or replace function public.admin_queue() returns table(
  case_id uuid, provider_id uuid, display_name text, provider_status provider_status, services text[],
  area_name text, submitted_at timestamptz, checks_passed int, checks_total int)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, p.id, p.display_name, p.status,
         coalesce((select array_agg(s.name order by s.name) from public.provider_services ps join public.services s on s.id = ps.service_id where ps.provider_id = p.id), '{}'),
         a.name, c.submitted_at,
         (select count(*)::int from public.verification_checks vc where vc.case_id = c.id and vc.status = 'pass'),
         (select count(*)::int from public.verification_checks vc where vc.case_id = c.id)
  from public.verification_cases c
  join public.providers p on p.id = c.provider_id
  left join public.areas a on a.id = p.base_area_id
  where public.can_verify() and c.submitted_at is not null
  order by case when p.status in ('submitted','in_review') then 0 else 1 end, c.submitted_at
$$;

create or replace function public.admin_case(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare c public.verification_cases%rowtype; p public.providers%rowtype;
begin
  if not public.can_verify() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into c from public.verification_cases where id = p_case;
  select * into p from public.providers where id = c.provider_id;
  return jsonb_build_object(
    'case', to_jsonb(c),
    'provider', jsonb_build_object('id', p.id, 'name', p.display_name, 'bio', p.bio, 'years', p.years_experience,
        'radius_km', p.radius_km, 'status', p.status, 'level', p.level,
        'area', (select name from public.areas where id = p.base_area_id)),
    'account', (select jsonb_build_object('full_name', full_name, 'phone', phone, 'avatar', avatar_path) from public.profiles where id = p.user_id),
    'private', (select jsonb_build_object('nin_last4', nin_last4, 'id_type', id_type, 'bank_name', bank_name,
        'bank_account_number', bank_account_number, 'bank_account_name', bank_account_name)
        from public.provider_private where provider_id = p.id),
    'guarantor', (select to_jsonb(g) from public.guarantors g where g.provider_id = p.id),
    'references', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]') from public.provider_references r where r.provider_id = p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'typical_price_kobo', ps.typical_price_kobo, 'status', ps.status)), '[]')
        from public.provider_services ps join public.services s on s.id = ps.service_id where ps.provider_id = p.id),
    'portfolio', (select coalesce(jsonb_agg(jsonb_build_object('path', photo_path, 'caption', caption)), '[]') from public.portfolio_items where provider_id = p.id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'path', storage_path, 'uploaded_at', uploaded_at) order by uploaded_at), '[]')
        from public.verification_documents where case_id = c.id),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'status', status, 'note', note, 'checked_at', checked_at) order by type), '[]')
        from public.verification_checks where case_id = c.id)
  );
end $$;

create or replace function public.admin_set_check(p_check uuid, p_status check_status, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare vc public.verification_checks%rowtype; cs public.verification_cases%rowtype;
begin
  if not public.can_verify() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into vc from public.verification_checks where id = p_check;
  if vc.id is null then raise exception 'Check not found'; end if;
  select * into cs from public.verification_cases where id = vc.case_id;
  if cs.status not in ('submitted','in_review') then raise exception 'This case is closed.'; end if;
  if p_status = 'fail' and length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Say why this check failed.'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  update public.verification_checks set status = p_status, note = nullif(trim(coalesce(p_note, '')), ''),
         checked_by = auth.uid(), checked_at = now() where id = p_check;
  if vc.type = 'guarantor' and p_status = 'pass' then update public.guarantors set confirmed_at = now() where provider_id = cs.provider_id; end if;
  if vc.type = 'reference' and p_status = 'pass' then update public.provider_references set called_at = now() where provider_id = cs.provider_id; end if;
  if cs.status = 'submitted' then
    update public.verification_cases set status = 'in_review', assigned_to = coalesce(assigned_to, auth.uid()) where id = cs.id;
    update public.providers set status = 'in_review' where id = cs.provider_id;
  end if;
  perform set_config('app.bypass_guard', 'off', true);
end $$;

create or replace function public.admin_decide(p_case uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare cs public.verification_cases%rowtype; pend int; total int; uid uuid; ntype text;
begin
  if not public.can_verify() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_decision not in ('approve','reject','needs_info') then raise exception 'Unknown decision'; end if;
  select * into cs from public.verification_cases where id = p_case;
  if cs.id is null or cs.status not in ('submitted','in_review') then raise exception 'This case is not open for a decision.'; end if;
  if p_decision <> 'approve' and length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give the provider a clear reason (at least 10 characters).'; end if;
  select count(*) filter (where status <> 'pass'), count(*) into pend, total from public.verification_checks where case_id = cs.id;
  if p_decision = 'approve' and (pend > 0 or total < 8) then
    raise exception 'All 8 checks must pass before approval. % still open.', pend; end if;
  select user_id into uid from public.providers where id = cs.provider_id;
  perform set_config('app.bypass_guard', 'on', true);
  if p_decision = 'approve' then
    update public.providers set status = 'approved', level = 2 where id = cs.provider_id;
    update public.provider_services set status = 'approved' where provider_id = cs.provider_id;
    update public.verification_cases set status = 'approved', decision_at = now(), rejection_reason = null where id = cs.id;
    ntype := 'provider_approved';
  elsif p_decision = 'reject' then
    update public.providers set status = 'rejected' where id = cs.provider_id;
    update public.verification_cases set status = 'rejected', decision_at = now(), rejection_reason = trim(p_reason) where id = cs.id;
    ntype := 'provider_rejected';
  else
    update public.providers set status = 'needs_info' where id = cs.provider_id;
    update public.verification_cases set status = 'needs_info', decision_at = now(), rejection_reason = trim(p_reason) where id = cs.id;
    ntype := 'provider_needs_info';
  end if;
  insert into public.notifications (user_id, type, payload) values (uid, ntype, jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), '')));
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Customer: requests, offers, acceptance
-- =====================================================================
create or replace function public.create_request(
  p_service_slug text, p_details jsonb, p_area_id uuid, p_address text,
  p_time_slot timestamptz, p_urgent boolean, p_budget_kobo bigint) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); svc public.services%rowtype; area_loc geography; req uuid; exp_h int; top_n int; same_day boolean;
begin
  if uid is null then raise exception 'Sign in to post a request.' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = uid and full_name is not null) then
    raise exception 'Add your full name before posting a request.'; end if;
  select * into svc from public.services where slug = p_service_slug and active;
  if svc.id is null then raise exception 'This service is not available yet.'; end if;
  select location into area_loc from public.areas where id = p_area_id and active;
  if area_loc is null then raise exception 'Choose the area where the work will happen.'; end if;
  if length(trim(coalesce(p_address, ''))) < 8 then raise exception 'Enter the full address so the provider can find you after you pay.'; end if;
  if length(p_details::text) > 6000 then raise exception 'The job description is too long.'; end if;
  if public.contains_contact_info(p_details::text) then
    raise exception 'Remove phone numbers, emails and chat app names from the job details. Contact details are shared only after payment.'; end if;
  if (select count(*) from public.requests where customer_id = uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You have posted several requests in the last hour. Wait a little, or cancel one you no longer need.'; end if;

  select value::text::int into exp_h from public.settings where key = case when p_urgent then 'urgent_expiry_hours' else 'request_expiry_hours' end;
  select value::text::int into top_n from public.settings where key = 'providers_notified_first';
  same_day := p_urgent or (p_time_slot is not null and (p_time_slot at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date);

  perform set_config('app.bypass_guard', 'on', true);
  insert into public.requests (customer_id, service_id, details, area_id, approx_location, time_slot, urgent, budget_kobo, status, expires_at)
  values (uid, svc.id, p_details, p_area_id, area_loc, p_time_slot, p_urgent, p_budget_kobo, 'open', now() + make_interval(hours => coalesce(exp_h, 24)))
  returning id into req;
  insert into public.request_private (request_id, address_text) values (req, trim(p_address));

  insert into public.request_recipients (request_id, provider_id)
  select req, p.id
  from public.providers p
  join public.provider_services ps on ps.provider_id = p.id and ps.service_id = svc.id and ps.status = 'approved'
  where p.status = 'approved' and p.user_id <> uid and p.base_location is not null
    and st_dwithin(p.base_location, area_loc, p.radius_km * 1000)
    and (not same_day or p.available_today)
  order by public.rank_score(case when p.rating_count = 0 then 4.0 else p.rating_avg end,
                             st_distance(p.base_location, area_loc) / 1000.0, p.radius_km, p.jobs_completed, p.response_rate) desc
  limit coalesce(top_n, 10);

  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'new_request', jsonb_build_object('request_id', req, 'service', svc.name)
  from public.request_recipients rr join public.providers p on p.id = rr.provider_id where rr.request_id = req;
  perform set_config('app.bypass_guard', 'off', true);
  return req;
end $$;

create or replace function public.request_notified_count(p_request uuid) returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from public.request_recipients rr join public.requests r on r.id = rr.request_id
  where rr.request_id = p_request and r.customer_id = auth.uid()
$$;

create or replace function public.request_offers(p_request uuid) returns table(
  offer_id uuid, provider_id uuid, price_kobo bigint, start_at timestamptz, message text, created_at timestamptz,
  offer_status offer_status, display_name text, avatar_path text, rating_avg numeric, rating_count int,
  jobs_completed int, years_experience int, level smallint, distance_km numeric, badges text[], match_score numeric)
language sql stable security definer set search_path = public, extensions as $$
  select o.id, p.id, o.price_kobo, o.start_at, o.message, o.created_at, o.status, p.display_name, pr.avatar_path,
         p.rating_avg, p.rating_count, p.jobs_completed, p.years_experience, p.level,
         round((st_distance(p.base_location, a.location) / 1000.0)::numeric, 1),
         public.provider_badges(p.id),
         round(public.rank_score(case when p.rating_count = 0 then 4.0 else p.rating_avg end,
               st_distance(p.base_location, a.location) / 1000.0, p.radius_km, p.jobs_completed, p.response_rate)::numeric, 2)
  from public.offers o
  join public.requests r on r.id = o.request_id
  join public.providers p on p.id = o.provider_id
  join public.profiles pr on pr.id = p.user_id
  left join public.areas a on a.id = r.area_id
  where o.request_id = p_request and r.customer_id = auth.uid() and o.status in ('sent','accepted')
  order by 17 desc, o.created_at
$$;

create or replace function public.my_requests() returns table(
  request_id uuid, service_name text, service_slug text, status text, area_name text, created_at timestamptz,
  expires_at timestamptz, urgent boolean, offers_count int, best_price_kobo bigint, job_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, s.name, s.slug,
         case when r.status in ('open','offers_received') and r.expires_at < now() then 'expired' else r.status::text end,
         a.name, r.created_at, r.expires_at, r.urgent,
         (select count(*)::int from public.offers o where o.request_id = r.id and o.status in ('sent','accepted')),
         (select min(o.price_kobo) from public.offers o where o.request_id = r.id and o.status in ('sent','accepted')),
         (select j.id from public.jobs j where j.request_id = r.id)
  from public.requests r join public.services s on s.id = r.service_id left join public.areas a on a.id = r.area_id
  where r.customer_id = auth.uid() order by r.created_at desc limit 50
$$;

create or replace function public.accept_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); o public.offers%rowtype; r public.requests%rowtype; svc public.services%rowtype;
        jid uuid := gen_random_uuid(); bps int; b bytea := extensions.gen_random_bytes(2); code text;
        item jsonb; n int; i int := 0; running bigint := 0; amt bigint;
begin
  select * into o from public.offers where id = p_offer for update;
  if o.id is null then raise exception 'This offer no longer exists.'; end if;
  select * into r from public.requests where id = o.request_id for update;
  if r.customer_id is distinct from uid then raise exception 'This is not your request.' using errcode = '42501'; end if;
  if o.status <> 'sent' or r.status not in ('open','offers_received') then raise exception 'This offer is no longer available.'; end if;
  if r.expires_at is not null and r.expires_at < now() then raise exception 'This request has expired. Post a new one to get fresh offers.'; end if;
  select * into svc from public.services where id = r.service_id;
  select value::text::int into bps from public.settings where key = 'commission_bps';
  code := lpad(((get_byte(b, 0) * 256 + get_byte(b, 1)) % 10000)::text, 4, '0');

  perform set_config('app.bypass_guard', 'on', true);
  update public.offers set status = 'accepted' where id = o.id;
  update public.offers set status = 'rejected' where request_id = o.request_id and id <> o.id and status = 'sent';
  update public.requests set status = 'accepted' where id = r.id;
  insert into public.jobs (id, request_id, offer_id, customer_id, provider_id, total_kobo, commission_bps)
  values (jid, r.id, o.id, uid, o.provider_id, o.price_kobo, coalesce(bps, 1000));
  insert into public.job_secrets (job_id, door_code) values (jid, code);

  if svc.pricing_mode = 'quote' then
    insert into public.job_milestones (job_id, label, position, amount_kobo) values (jid, 'Site inspection fee', 1, o.price_kobo);
  else
    n := jsonb_array_length(svc.milestone_template);
    for item in select * from jsonb_array_elements(svc.milestone_template) loop
      i := i + 1;
      if i < n then amt := floor(o.price_kobo * (item->>'percent')::numeric / 100); running := running + amt;
      else amt := o.price_kobo - running; end if;
      insert into public.job_milestones (job_id, label, position, amount_kobo) values (jid, item->>'label', i, amt);
    end loop;
  end if;

  insert into public.job_events (job_id, actor_id, event, note) values (jid, uid, 'job_created', 'Offer accepted. Waiting for payment.');
  insert into public.notifications (user_id, type, payload)
  select p.user_id, case when oo.id = o.id then 'offer_accepted' else 'offer_not_selected' end,
         jsonb_build_object('request_id', r.id, 'job_id', case when oo.id = o.id then jid end)
  from public.offers oo join public.providers p on p.id = oo.provider_id
  where oo.request_id = r.id and oo.status in ('accepted','rejected');
  perform set_config('app.bypass_guard', 'off', true);
  return jid;
end $$;

-- TEST MODE ONLY. Controlled by settings.test_payments. Replaced by Paystack in Phase 4.
create or replace function public.test_mark_job_paid(p_job uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; enabled boolean;
begin
  select (value::text = 'true') into enabled from public.settings where key = 'test_payments';
  if not coalesce(enabled, false) then raise exception 'Test payments are switched off.'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or j.customer_id is distinct from auth.uid() then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status <> 'awaiting_payment' then raise exception 'This job is already paid.'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  update public.job_milestones set status = 'paid_held' where job_id = j.id and position = 1;
  update public.jobs set status = 'paid_held' where id = j.id;
  insert into public.job_events (job_id, actor_id, event, note) values (j.id, auth.uid(), 'payment_held', 'Test payment recorded. Funds held until you confirm the work.');
  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'job_paid', jsonb_build_object('job_id', j.id) from public.providers p where p.id = j.provider_id;
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Provider: inbox
-- =====================================================================
create or replace function public.provider_inbox() returns table(
  request_id uuid, service_name text, service_slug text, details jsonb, area_name text, time_slot timestamptz,
  urgent boolean, budget_kobo bigint, request_status text, expires_at timestamptz, created_at timestamptz,
  distance_km numeric, my_offer_id uuid, my_offer_price_kobo bigint, my_offer_status offer_status, job_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, s.name, s.slug, r.details, a.name, r.time_slot, r.urgent, r.budget_kobo,
         case when r.status in ('open','offers_received') and r.expires_at < now() then 'expired' else r.status::text end,
         r.expires_at, r.created_at,
         round((st_distance(p.base_location, r.approx_location) / 1000.0)::numeric, 1),
         o.id, o.price_kobo, o.status, j.id
  from public.request_recipients rr
  join public.providers p on p.id = rr.provider_id
  join public.requests r on r.id = rr.request_id
  join public.services s on s.id = r.service_id
  left join public.areas a on a.id = r.area_id
  left join public.offers o on o.request_id = r.id and o.provider_id = rr.provider_id
  left join public.jobs j on j.request_id = r.id and j.provider_id = rr.provider_id
  where p.user_id = auth.uid()
  order by r.created_at desc limit 100
$$;

-- =====================================================================
-- Jobs and profiles
-- =====================================================================
create or replace function public.job_view(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); j public.jobs%rowtype; pid uuid := public.my_provider_id();
        is_cust boolean; is_prov boolean; paid boolean;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null then return null; end if;
  is_cust := j.customer_id = uid; is_prov := j.provider_id = pid;
  if not (is_cust or is_prov or public.is_staff()) then return null; end if;
  paid := j.status not in ('awaiting_payment','cancelled');
  return jsonb_build_object(
    'job', to_jsonb(j) - 'offer_id',
    'role', case when is_cust then 'customer' when is_prov then 'provider' else 'staff' end,
    'payout_kobo', case when is_prov then j.total_kobo - round(j.total_kobo * j.commission_bps / 10000.0) end,
    'service', (select jsonb_build_object('name', s.name, 'slug', s.slug, 'pricing_mode', s.pricing_mode)
                from public.requests r join public.services s on s.id = r.service_id where r.id = j.request_id),
    'request', (select jsonb_build_object('details', r.details, 'time_slot', r.time_slot, 'urgent', r.urgent, 'area', a.name)
                from public.requests r left join public.areas a on a.id = r.area_id where r.id = j.request_id),
    'address', case when paid and (is_cust or is_prov) then (select address_text from public.request_private where request_id = j.request_id) end,
    'door_code', case when is_cust then (select door_code from public.job_secrets where job_id = j.id) end,
    'milestones', (select coalesce(jsonb_agg(to_jsonb(m) order by m.position), '[]') from public.job_milestones m where m.job_id = j.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'note', e.note, 'at', e.created_at) order by e.created_at), '[]')
               from public.job_events e where e.job_id = j.id),
    'provider', case when is_cust or public.is_staff() then
        (select jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', pr.avatar_path, 'rating', p.rating_avg,
                'rating_count', p.rating_count, 'jobs', p.jobs_completed, 'level', p.level, 'badges', public.provider_badges(p.id))
         from public.providers p join public.profiles pr on pr.id = p.user_id where p.id = j.provider_id) end,
    'customer', case when is_prov and paid then
        (select jsonb_build_object('first_name', split_part(coalesce(full_name, ''), ' ', 1)) from public.profiles where id = j.customer_id) end,
    'offer', (select jsonb_build_object('message', o.message, 'start_at', o.start_at) from public.offers o where o.id = j.offer_id)
  );
end $$;

create or replace function public.my_jobs() returns table(
  job_id uuid, role text, service_name text, counterpart text, total_kobo bigint, status job_status, area_name text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select j.id, case when j.customer_id = auth.uid() then 'customer' else 'provider' end, s.name,
         case when j.customer_id = auth.uid() then p.display_name
              when j.status = 'awaiting_payment' then 'Customer'
              else coalesce(nullif(split_part(coalesce(c.full_name, ''), ' ', 1), ''), 'Customer') end,
         j.total_kobo, j.status, a.name, j.created_at
  from public.jobs j
  join public.requests r on r.id = j.request_id
  join public.services s on s.id = r.service_id
  join public.providers p on p.id = j.provider_id
  join public.profiles c on c.id = j.customer_id
  left join public.areas a on a.id = r.area_id
  where j.customer_id = auth.uid() or p.user_id = auth.uid()
  order by j.created_at desc limit 100
$$;

create or replace function public.public_provider(p_provider uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.display_name, 'bio', p.bio, 'years', p.years_experience, 'avatar', pr.avatar_path,
    'rating', p.rating_avg, 'rating_count', p.rating_count, 'jobs', p.jobs_completed, 'level', p.level,
    'area', a.name, 'member_since', p.created_at, 'badges', public.provider_badges(p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'typical_price_kobo', ps.typical_price_kobo)), '[]')
                 from public.provider_services ps join public.services s on s.id = ps.service_id
                 where ps.provider_id = p.id and ps.status = 'approved'),
    'portfolio', (select coalesce(jsonb_agg(jsonb_build_object('path', pi.photo_path, 'caption', pi.caption)), '[]')
                  from public.portfolio_items pi where pi.provider_id = p.id),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('stars', rv.stars, 'comment', rv.comment, 'at', rv.created_at)), '[]')
                from (select stars, comment, created_at from public.reviews where reviewee_id = p.user_id order by created_at desc limit 10) rv))
  from public.providers p
  join public.profiles pr on pr.id = p.user_id
  left join public.areas a on a.id = p.base_area_id
  where p.id = p_provider and p.status = 'approved'
$$;

-- =====================================================================
-- Permissions: functions are callable by signed-in users only
-- =====================================================================
revoke execute on function public.test_mark_job_paid(uuid), public.create_request(text, jsonb, uuid, text, timestamptz, boolean, bigint),
  public.accept_offer(uuid), public.admin_queue(), public.admin_case(uuid), public.admin_set_check(uuid, check_status, text),
  public.admin_decide(uuid, text, text), public.save_nin(text, text), public.save_bank(text, text, text),
  public.save_guarantor(text, text, text, text, int), public.save_references(jsonb), public.my_verification_progress(),
  public.submit_verification(jsonb), public.ensure_verification_case(), public.request_offers(uuid), public.request_notified_count(uuid),
  public.my_requests(), public.provider_inbox(), public.job_view(uuid), public.my_jobs(), public.public_provider(uuid)
  from public, anon;
grant execute on function public.test_mark_job_paid(uuid), public.create_request(text, jsonb, uuid, text, timestamptz, boolean, bigint),
  public.accept_offer(uuid), public.admin_queue(), public.admin_case(uuid), public.admin_set_check(uuid, check_status, text),
  public.admin_decide(uuid, text, text), public.save_nin(text, text), public.save_bank(text, text, text),
  public.save_guarantor(text, text, text, text, int), public.save_references(jsonb), public.my_verification_progress(),
  public.submit_verification(jsonb), public.ensure_verification_case(), public.request_offers(uuid), public.request_notified_count(uuid),
  public.my_requests(), public.provider_inbox(), public.job_view(uuid), public.my_jobs(), public.public_provider(uuid)
  to authenticated;

-- Providers may delete their own uploaded verification files before submitting.
create policy "owner deletes verification files" on storage.objects for delete to authenticated
  using (bucket_id = 'verification' and (storage.foldername(name))[1] = auth.uid()::text);
