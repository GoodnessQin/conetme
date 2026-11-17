-- Public marketplace: slugs, banners, likes, browse/search, Google sign-in users, banner changes.

alter table public.providers add column if not exists slug text unique,
  add column if not exists banner_path text,
  add column if not exists tagline text check (tagline is null or length(tagline) <= 90),
  add column if not exists featured boolean not null default false;
alter table public.services add column if not exists image_path text;

alter table public.provider_change_requests drop constraint if exists provider_change_requests_kind_check;
alter table public.provider_change_requests add constraint provider_change_requests_kind_check check (kind in ('area','service','photo','banner'));

create or replace function public.make_slug(p_name text) returns text
language plpgsql set search_path = public as $$
declare base text; s text; n int := 1;
begin
  base := regexp_replace(lower(coalesce(p_name, 'provider')), '[^a-z0-9]+', '-', 'g');
  base := trim(both '-' from base);
  if base = '' then base := 'provider'; end if;
  base := left(base, 40); s := base;
  while exists (select 1 from public.providers where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  return s;
end $$;

create or replace function public.set_provider_slug() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.slug is null then new.slug := public.make_slug(new.display_name); end if;
  return new;
end $$;
drop trigger if exists providers_slug on public.providers;
create trigger providers_slug before insert on public.providers for each row execute function public.set_provider_slug();
update public.providers set slug = public.make_slug(display_name) where slug is null;

-- Providers may edit their tagline; banner, slug and featured flag are controlled.
create or replace function public.guard_providers() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.guards_bypassed() then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_staff() then
      new.status := 'draft'; new.level := 0; new.rating_avg := 0; new.rating_count := 0;
      new.jobs_completed := 0; new.response_rate := 1; new.cancellation_count := 0;
      new.no_show_count := 0; new.job_cap_kobo := 10000000;
      new.banner_path := null; new.featured := false;
    end if;
    return new;
  end if;
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_staff() then return new; end if;
  if new.status is distinct from old.status or new.level is distinct from old.level
     or new.rating_avg is distinct from old.rating_avg or new.rating_count is distinct from old.rating_count
     or new.jobs_completed is distinct from old.jobs_completed or new.response_rate is distinct from old.response_rate
     or new.cancellation_count is distinct from old.cancellation_count or new.no_show_count is distinct from old.no_show_count
     or new.job_cap_kobo is distinct from old.job_cap_kobo or new.user_id is distinct from old.user_id
     or new.banner_path is distinct from old.banner_path or new.featured is distinct from old.featured or new.slug is distinct from old.slug then
    raise exception 'protected provider field' using errcode = '42501';
  end if;
  if new.tagline is not null and public.contains_contact_info(new.tagline) then
    raise exception 'Remove phone numbers, emails and chat app names from your tagline.'; end if;
  return new;
end $$;

-- Google sign-in users have no phone number.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone, full_name, email)
  values (new.id, nullif(new.phone, ''), nullif(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ''), new.email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'customer') on conflict do nothing;
  return new;
end $$;

-- A phone number added later (Google sign-in) or changed through Auth flows into the profile.
create or replace function public.sync_profile_phone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.phone is distinct from old.phone then
    update public.profiles set phone = nullif(new.phone, '') where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_phone on auth.users;
create trigger on_auth_user_phone after update of phone on auth.users for each row execute function public.sync_profile_phone();

-- Providers need a verified phone to receive job alerts.
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
  if not exists (select 1 from public.profiles where id = auth.uid() and phone is not null) then missing := missing || 'a verified phone number'; end if;
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

-- ---------------- likes ----------------
create table if not exists public.provider_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, provider_id)
);
alter table public.provider_likes enable row level security;
create policy likes_own on public.provider_likes for select to authenticated using (user_id = auth.uid() or public.is_staff());

create or replace function public.toggle_like(p_provider uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to save providers.' using errcode = '28000'; end if;
  if not exists (select 1 from public.providers where id = p_provider and status = 'approved') then raise exception 'Provider not found.'; end if;
  if exists (select 1 from public.providers where id = p_provider and user_id = uid) then raise exception 'You cannot save your own profile.'; end if;
  if exists (select 1 from public.provider_likes where user_id = uid and provider_id = p_provider) then
    delete from public.provider_likes where user_id = uid and provider_id = p_provider; return false;
  end if;
  insert into public.provider_likes (user_id, provider_id) values (uid, p_provider);
  return true;
end $$;

create or replace function public.my_likes() returns setof uuid
language sql stable security definer set search_path = public as $$
  select provider_id from public.provider_likes where user_id = auth.uid()
$$;

-- ---------------- homepage banners ----------------
create table if not exists public.marketplace_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 3 and 80),
  subtitle text check (subtitle is null or length(subtitle) <= 140),
  image_path text,
  link text check (link is null or link ~ '^/'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.marketplace_banners enable row level security;
create policy banners_read on public.marketplace_banners for select to anon, authenticated using (active or public.is_admin());
create policy banners_admin on public.marketplace_banners for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop trigger if exists marketplace_banners_audit on public.marketplace_banners;
create trigger marketplace_banners_audit after insert or update or delete on public.marketplace_banners for each row execute function public.audit_row();

create or replace function public.admin_set_featured(p_provider uuid, p_featured boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can feature providers.' using errcode = '42501'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  update public.providers set featured = coalesce(p_featured, false) where id = p_provider and status = 'approved';
  perform set_config('app.bypass_guard', 'off', true);
  insert into public.audit_log (actor_id, action, entity, entity_id, after) values (auth.uid(), 'provider_featured', 'providers', p_provider::text, jsonb_build_object('featured', p_featured));
end $$;

-- ---------------- browse ----------------
create or replace function public.marketplace_providers(p_state text default null, p_area_id uuid default null, p_service_slug text default null,
  p_query text default null, p_sort text default 'top', p_limit int default 24, p_offset int default 0)
returns table(provider_id uuid, slug text, name text, tagline text, avatar_path text, banner_path text, service_name text, service_slug text, service_image text,
  area text, state text, rating_avg numeric, rating_count int, jobs_completed int, level smallint, from_price_kobo bigint, likes bigint, liked boolean, featured boolean, available_today boolean)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.slug, p.display_name, p.tagline, pr.avatar_path, p.banner_path,
         s.name, s.slug, s.image_path, a.name, a.state, p.rating_avg, p.rating_count, p.jobs_completed, p.level,
         (select min(ps2.typical_price_kobo) from public.provider_services ps2 where ps2.provider_id = p.id and ps2.status = 'approved'),
         (select count(*) from public.provider_likes l where l.provider_id = p.id),
         exists (select 1 from public.provider_likes l where l.provider_id = p.id and l.user_id = auth.uid()),
         p.featured, p.available_today
  from public.providers p
  join public.profiles pr on pr.id = p.user_id
  left join public.areas a on a.id = p.base_area_id
  join lateral (select s1.* from public.provider_services ps1 join public.services s1 on s1.id = ps1.service_id
                where ps1.provider_id = p.id and ps1.status = 'approved' and s1.active
                  and (p_service_slug is null or s1.slug = p_service_slug) order by s1.sort_order limit 1) s on true
  where p.status = 'approved' and (a.id is null or a.active)
    and (p_state is null or a.state = p_state)
    and (p_area_id is null or p.base_area_id = p_area_id)
    and (coalesce(trim(p_query), '') = '' or p.display_name ilike '%' || trim(p_query) || '%' or coalesce(p.tagline, '') ilike '%' || trim(p_query) || '%'
         or s.name ilike '%' || trim(p_query) || '%' or exists (select 1 from unnest(s.keywords) k where trim(p_query) ilike '%' || k || '%'))
  order by case p_sort when 'new' then extract(epoch from p.created_at) * -1 else 0 end,
           case p_sort when 'jobs' then p.jobs_completed * -1 else 0 end,
           p.featured desc, (case when p.rating_count = 0 then 4.0 else p.rating_avg end) desc, p.jobs_completed desc
  limit least(coalesce(p_limit, 24), 60) offset greatest(coalesce(p_offset, 0), 0)
$$;

alter function public.public_provider(uuid) rename to public_provider_base;
create or replace function public.public_provider(p_provider uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select b || jsonb_build_object('slug', p.slug, 'banner', p.banner_path, 'tagline', p.tagline,
    'likes', (select count(*) from public.provider_likes l where l.provider_id = p.id),
    'liked', exists (select 1 from public.provider_likes l where l.provider_id = p.id and l.user_id = auth.uid()))
  from public.providers p, lateral (select public.public_provider_base(p.id) as b) x
  where p.id = p_provider and x.b is not null
$$;
create or replace function public.public_provider_by_slug(p_slug text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select public.public_provider(p.id) from public.providers p where p.slug = lower(trim(p_slug)) and p.status in ('approved','suspended')
$$;

-- ---------------- matching (visitors can browse who is available) ----------------
create or replace function public.match_providers(p_service_slug text, p_area_id uuid, p_lat double precision, p_lng double precision, p_budget_kobo bigint, p_urgent boolean)
returns table(provider_id uuid, name text, avatar_path text, rating_avg numeric, rating_count int, jobs_completed int, years_experience int, level smallint,
              distance_km numeric, typical_price_kobo bigint, price_low_kobo bigint, price_high_kobo bigint, available_today boolean, within_budget boolean, match_score numeric)
language plpgsql stable security definer set search_path = public, extensions as $$
declare pt geography;
begin
  if p_lat is not null and p_lng is not null and p_lat between 3.5 and 14 and p_lng between 2.5 and 15 then
    pt := st_setsrid(st_makepoint(round(p_lng::numeric, 2)::float8, round(p_lat::numeric, 2)::float8), 4326)::geography;
  else
    select location into pt from public.areas where id = p_area_id;
  end if;
  if pt is null then return; end if;
  return query
  select p.id, p.display_name, pr.avatar_path, p.rating_avg, p.rating_count, p.jobs_completed, p.years_experience, p.level,
         round((st_distance(p.base_location, pt) / 1000.0)::numeric, 1), ps.typical_price_kobo,
         (round(ps.typical_price_kobo * 0.9 / 50000.0) * 50000)::bigint, (round(ps.typical_price_kobo * 1.2 / 50000.0) * 50000)::bigint,
         p.available_today,
         (p_budget_kobo is null or p_budget_kobo = 0 or ps.typical_price_kobo * 0.9 <= p_budget_kobo),
         round(public.rank_score(case when p.rating_count = 0 then 4.0 else p.rating_avg end, st_distance(p.base_location, pt) / 1000.0, p.radius_km, p.jobs_completed, p.response_rate)::numeric, 2)
  from public.providers p
  join public.profiles pr on pr.id = p.user_id
  join public.provider_services ps on ps.provider_id = p.id and ps.status = 'approved'
  join public.services s on s.id = ps.service_id and s.slug = p_service_slug
  where p.status = 'approved' and p.user_id is distinct from auth.uid() and p.base_location is not null
    and st_dwithin(p.base_location, pt, p.radius_km * 1000)
    and (not coalesce(p_urgent, false) or p.available_today)
  order by 14 desc, 15 desc limit 20;
end $$;

create or replace function public.request_provider_change(p_kind text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id(); p public.providers%rowtype; rid uuid; uid uuid := auth.uid();
begin
  select * into p from public.providers where id = pid;
  if p.id is null or p.status <> 'approved' then raise exception 'Only approved providers can request profile changes.'; end if;
  if exists (select 1 from public.provider_change_requests where provider_id = pid and kind = p_kind and status = 'pending') then raise exception 'You already have a pending request of this kind. Wait for our team to review it.'; end if;
  if p_kind = 'area' then
    if not exists (select 1 from public.areas where id = (p_payload->>'area_id')::uuid and active) then raise exception 'Choose a valid area.'; end if;
    if (p_payload->>'area_id')::uuid = p.base_area_id then raise exception 'That is already your area.'; end if;
  elsif p_kind = 'service' then
    if not exists (select 1 from public.services where id = (p_payload->>'service_id')::uuid and active) then raise exception 'Choose a valid service.'; end if;
    if exists (select 1 from public.provider_services where provider_id = pid and service_id = (p_payload->>'service_id')::uuid) then raise exception 'You already offer this service.'; end if;
    if coalesce((p_payload->>'typical_price_kobo')::bigint, 0) < 50000 then raise exception 'Enter a typical price of at least NGN 500.'; end if;
    if length(trim(coalesce(p_payload->>'note', ''))) < 20 then raise exception 'Describe your experience and qualifications for this service (at least 20 characters).'; end if;
    if jsonb_array_length(coalesce(p_payload->'doc_paths', '[]')) < 1 or exists (select 1 from jsonb_array_elements_text(p_payload->'doc_paths') d where d not like uid::text || '/%') then raise exception 'Upload at least one credential document.'; end if;
  elsif p_kind = 'photo' then
    if coalesce(p_payload->>'avatar_path', '') not like uid::text || '/%' then raise exception 'Upload your new photo first.'; end if;
  elsif p_kind = 'banner' then
    if coalesce(p_payload->>'banner_path', '') not like uid::text || '/%' then raise exception 'Upload your banner image first.'; end if;
  else raise exception 'Unknown request.'; end if;
  insert into public.provider_change_requests (provider_id, kind, payload) values (pid, p_kind, p_payload) returning id into rid;
  return rid;
end $$;

create or replace function public.admin_provider_changes() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]') from (
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'provider_id', p.id, 'provider_name', p.display_name, 'payload', c.payload, 'created_at', c.created_at,
      'current_area', (select name from public.areas where id = p.base_area_id),
      'new_area', (select name from public.areas where id = (c.payload->>'area_id')::uuid),
      'service_name', (select name from public.services where id = (c.payload->>'service_id')::uuid),
      'current_avatar', (select avatar_path from public.profiles where id = p.user_id), 'current_banner', p.banner_path) as x
    from public.provider_change_requests c join public.providers p on p.id = c.provider_id
    where c.status = 'pending' and public.can_verify()) t
$$;

create or replace function public.admin_decide_change(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare c public.provider_change_requests%rowtype; p public.providers%rowtype;
begin
  if not public.can_verify() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into c from public.provider_change_requests where id = p_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'This request was already decided.'; end if;
  select * into p from public.providers where id = c.provider_id;
  if p.user_id = auth.uid() then raise exception 'You cannot review your own request.' using errcode = '42501'; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 10 then raise exception 'Give the provider a clear reason (at least 10 characters).'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  if p_approve then
    if c.kind = 'area' then update public.providers set base_area_id = (c.payload->>'area_id')::uuid where id = p.id;
    elsif c.kind = 'service' then
      insert into public.provider_services (provider_id, service_id, typical_price_kobo, status) values (p.id, (c.payload->>'service_id')::uuid, (c.payload->>'typical_price_kobo')::bigint, 'approved')
      on conflict (provider_id, service_id) do update set status = 'approved', typical_price_kobo = excluded.typical_price_kobo;
    elsif c.kind = 'banner' then update public.providers set banner_path = c.payload->>'banner_path' where id = p.id;
    elsif c.kind = 'photo' then update public.profiles set avatar_path = c.payload->>'avatar_path' where id = p.user_id;
    end if;
  end if;
  update public.provider_change_requests set status = case when p_approve then 'approved' else 'rejected' end, note = nullif(trim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now() where id = c.id;
  insert into public.notifications (user_id, type, payload) values (p.user_id, case when p_approve then 'change_approved' else 'change_rejected' end, jsonb_build_object('kind', c.kind, 'reason', nullif(trim(coalesce(p_note, '')), '')));
  perform set_config('app.bypass_guard', 'off', true);
end $$;

revoke execute on all functions in schema public from anon;
grant execute on function public.list_areas(), public.marketplace_providers(text, uuid, text, text, text, int, int),
  public.public_provider(uuid), public.public_provider_by_slug(text), public.public_provider_base(uuid),
  public.service_coverage(text, uuid) to anon;
grant execute on function public.match_providers(text, uuid, double precision, double precision, bigint, boolean) to anon;
revoke execute on function public.public_provider_base(uuid) from anon, authenticated;
grant select on public.services, public.areas to anon;
grant select on public.marketplace_banners to anon;
