-- Phase 3c: admins can add any service, demand capture, coverage check, readable document names, no self-review.
-- Run once in the Supabase SQL editor after 20261025000001.

alter table public.services add column if not exists keywords text[] not null default '{}',
  add column if not exists credential_requirements jsonb not null default '{"items":["Certificates, licences or permits that apply to this work","Photos or documents that show you have done this work before"],"note":"Upload at least one document. A reviewer may ask for more."}';
alter table public.verification_documents add column if not exists original_name text;

update public.services set keywords = array['plumb','leak','pipe','tap','drain','toilet','water heater','borehole','pump','blocked','sink','cistern','flush'],
  credential_requirements = '{"items":["Trade or apprenticeship certificate, if you have one","A clear photo of your tools and, if you have one, your work van"],"note":"Upload at least one document. Your three work photos in the next step are reviewed alongside it."}' where slug = 'plumber';
update public.services set keywords = array['cater','wedding','party','buffet','small chops','event','jollof','birthday','naming','cook','meal','guests'],
  credential_requirements = '{"items":["Food handler''s medical fitness certificate","Local government or state health permit, where required","NAFDAC number if you sell packaged food","Photos of your kitchen and equipment"],"note":"Upload at least one document. A reviewer may ask for a kitchen visit before approval."}' where slug = 'caterer';
update public.services set keywords = array['solar','inverter','panel','batter','kva','power backup','generator cost','off-grid'],
  credential_requirements = '{"items":["CAC registration if you operate as a company","Brand or manufacturer training certificates","Electrical competence evidence: trade test, engineering registration or an employer''s letter","Photos and addresses of past installations","The warranty terms you give customers"],"note":"Solar systems carry fire and electrical risk. Reviewers look closely at competence and past installations."}' where slug = 'solar-installer';

create trigger audit_services after insert or update on public.services for each row execute function public.audit_row();

insert into public.areas (name, city, state, location) values
('Ikoyi','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.4246 6.4549)')),
('Ikeja GRA','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.347 6.581)')),
('Magodo','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.383 6.615)')),
('Gbagada','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.392 6.554)')),
('Maryland','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.363 6.568)')),
('Oshodi','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.343 6.557)')),
('Festac','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.283 6.465)')),
('Apapa','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.359 6.45)')),
('Ogudu','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.396 6.578)')),
('Asokoro','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.531 9.043)')),
('Kubwa','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.322 9.155)')),
('Lugbe','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.3797 8.9892)')),
('Utako','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.445 9.069)')),
('Life Camp','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.395 9.095)')),
('Wuye','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.465 9.064)')),
('Katampe','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.46 9.1)')),
('Apo','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.496 8.997)')),
('Gwagwalada','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.083 8.942)'))
on conflict (city, name) do nothing;

-- Demand signals: what customers ask for that we do not offer, or where we have no providers
create table if not exists public.service_interest (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('unmatched','no_coverage')),
  text text not null,
  service_slug text,
  area_id uuid references public.areas(id),
  created_at timestamptz not null default now()
);
alter table public.service_interest enable row level security;
create policy interest_staff on public.service_interest for select to authenticated using (public.is_staff());

create or replace function public.record_service_interest(p_text text, p_area_id uuid, p_kind text, p_service_slug text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return; end if;
  if p_kind not in ('unmatched','no_coverage') then return; end if;
  if (select count(*) from public.service_interest where user_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then return; end if;
  insert into public.service_interest (user_id, kind, text, service_slug, area_id) values (auth.uid(), p_kind, left(trim(coalesce(p_text, '')), 300), p_service_slug, p_area_id);
end $$;

create or replace function public.admin_service_interest() returns table(kind text, text text, service_slug text, area_name text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select i.kind, i.text, i.service_slug, a.name, i.created_at from public.service_interest i left join public.areas a on a.id = i.area_id
  where public.is_staff() order by i.created_at desc limit 200
$$;

create or replace function public.service_coverage(p_service_slug text, p_area_id uuid) returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int
  from public.providers p
  join public.provider_services ps on ps.provider_id = p.id and ps.status = 'approved'
  join public.services s on s.id = ps.service_id and s.slug = p_service_slug
  join public.areas a on a.id = p_area_id
  where p.status = 'approved' and p.base_location is not null and st_dwithin(p.base_location, a.location, p.radius_km * 1000)
$$;

-- Admins add or edit any service: no code change needed
create or replace function public.admin_upsert_service(
  p_id uuid, p_name text, p_description text, p_pricing_mode text, p_keywords text[], p_form_schema jsonb, p_milestones jsonb,
  p_credentials jsonb, p_inspection_fee_kobo bigint, p_job_cap_kobo bigint, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare pct numeric; v_slug text; sid uuid; kw text[]; n int := 1; base text;
begin
  if not public.is_admin() then raise exception 'Only admins can change services.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Give the service a name of at least 3 characters.'; end if;
  if p_pricing_mode not in ('fixed','estimate','quote') then raise exception 'Choose a pricing style.'; end if;
  if jsonb_typeof(p_milestones) <> 'array' or jsonb_array_length(p_milestones) not between 1 and 5 then raise exception 'Use between 1 and 5 payment stages.'; end if;
  select coalesce(sum((m->>'percent')::numeric), 0) into pct from jsonb_array_elements(p_milestones) m;
  if pct <> 100 then raise exception 'Payment stages must add up to 100 percent (they add up to %).', pct; end if;
  if jsonb_typeof(p_form_schema) <> 'array' then raise exception 'The request form must be a list of questions.'; end if;
  if (select count(*) from jsonb_array_elements(p_form_schema) f where length(coalesce(f->>'label','')) < 2 or (f->>'type') not in ('text','textarea','number','select','multiselect')) > 0 then
    raise exception 'Every question needs a label and a valid type.'; end if;
  select coalesce(array_agg(distinct lower(trim(k))) filter (where length(trim(k)) > 1), '{}') into kw from unnest(coalesce(p_keywords, '{}')) k;
  if p_id is null then
    base := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
    v_slug := base;
    while exists (select 1 from public.services s2 where s2.slug = v_slug) loop n := n + 1; v_slug := base || '-' || n; end loop;
    insert into public.services (slug, name, description, pricing_mode, keywords, form_schema, milestone_template, credential_requirements, inspection_fee_kobo, job_cap_kobo, active, sort_order)
    values (v_slug, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_pricing_mode, kw, p_form_schema, p_milestones, p_credentials, coalesce(p_inspection_fee_kobo, 0), coalesce(p_job_cap_kobo, 10000000), coalesce(p_active, true),
            coalesce((select max(sort_order) + 1 from public.services), 1))
    returning id into sid;
  else
    update public.services set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''), pricing_mode = p_pricing_mode, keywords = kw,
      form_schema = p_form_schema, milestone_template = p_milestones, credential_requirements = p_credentials,
      inspection_fee_kobo = coalesce(p_inspection_fee_kobo, 0), job_cap_kobo = coalesce(p_job_cap_kobo, 10000000), active = coalesce(p_active, true)
    where id = p_id returning id into sid;
  end if;
  return sid;
end $$;

-- Admin review: readable file names, and nobody reviews their own application
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
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'path', storage_path, 'name', original_name, 'uploaded_at', uploaded_at) order by uploaded_at), '[]')
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
  if exists (select 1 from public.providers where id = cs.provider_id and user_id = auth.uid()) then
    raise exception 'You cannot review your own application. Use a different admin account.' using errcode = '42501'; end if;
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
  if exists (select 1 from public.providers where id = cs.provider_id and user_id = auth.uid()) then
    raise exception 'You cannot review your own application. Use a different admin account.' using errcode = '42501'; end if;
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

revoke execute on function public.record_service_interest(text, uuid, text, text), public.admin_service_interest(), public.service_coverage(text, uuid),
  public.admin_upsert_service(uuid, text, text, text, text[], jsonb, jsonb, jsonb, bigint, bigint, boolean) from public, anon;
grant execute on function public.record_service_interest(text, uuid, text, text), public.admin_service_interest(), public.service_coverage(text, uuid),
  public.admin_upsert_service(uuid, text, text, text, text[], jsonb, jsonb, jsonb, bigint, bigint, boolean) to authenticated;

-- Providers may remove their own uploaded files before submitting (safe to run even if it already exists)
drop policy if exists "owner deletes verification files" on storage.objects;
create policy "owner deletes verification files" on storage.objects for delete to authenticated
  using (bucket_id = 'verification' and (storage.foldername(name))[1] = auth.uid()::text);
