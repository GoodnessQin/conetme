-- Phase 5: admin monitoring of customers, requests and jobs; customer suspension; separate provider profile management
-- with approval for sensitive changes; choose-your-providers matching; rating labels and tags; phone sharing for arrival.
-- Run once in the Supabase SQL editor after 20261027000001.

-- =====================================================================
-- Support role helper and customer suspension
-- =====================================================================
create or replace function public.is_support() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.has_role('support') or public.is_admin() $$;

alter table public.profiles add column if not exists suspended_at timestamptz, add column if not exists suspended_reason text;
alter table public.reviews add column if not exists tags text[] not null default '{}';

create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.guards_bypassed() or coalesce(auth.role(), 'service_role') = 'service_role' or public.is_admin() then return new; end if;
  if new.customer_verified is distinct from old.customer_verified or new.phone is distinct from old.phone or new.id is distinct from old.id
     or new.suspended_at is distinct from old.suspended_at or new.suspended_reason is distinct from old.suspended_reason then
    raise exception 'protected profile field' using errcode = '42501';
  end if;
  -- A verified provider's photo is what customers use to recognise them at the door, so changes are reviewed.
  if new.avatar_path is distinct from old.avatar_path and exists (select 1 from public.providers p where p.user_id = old.id and p.status not in ('draft','needs_info')) then
    raise exception 'Profile photo changes for verified providers need approval. Request the change from your provider profile.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.block_suspended_customer() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from public.profiles where id = new.customer_id and suspended_at is not null) then
    raise exception 'Your account is suspended. Contact ConnectMe support.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists requests_block_suspended on public.requests;
create trigger requests_block_suspended before insert on public.requests for each row execute function public.block_suspended_customer();
drop trigger if exists jobs_block_suspended on public.jobs;
create trigger jobs_block_suspended before insert on public.jobs for each row execute function public.block_suspended_customer();
drop trigger if exists payments_block_suspended on public.payments;
create trigger payments_block_suspended before insert on public.payments for each row when (new.customer_id is not null) execute function public.block_suspended_customer();

create or replace function public.admin_set_customer_status(p_user uuid, p_suspend boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_support() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own account status.' using errcode = '42501'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role in ('verifier','support','finance','admin')) then raise exception 'Staff accounts cannot be suspended here.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Write a clear reason (at least 10 characters).'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  update public.profiles set suspended_at = case when p_suspend then now() else null end, suspended_reason = case when p_suspend then trim(p_reason) else null end where id = p_user;
  insert into public.notifications (user_id, type, payload) values (p_user, case when p_suspend then 'account_suspended' else 'account_reinstated' end, jsonb_build_object('reason', trim(p_reason)));
  insert into public.audit_log (actor_id, action, entity, entity_id, after) values (auth.uid(), case when p_suspend then 'customer_suspended' else 'customer_reinstated' end, 'profiles', p_user::text, jsonb_build_object('reason', trim(p_reason)));
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Phone sharing for arrival (the customer or provider opts in, per job)
-- =====================================================================
create table if not exists public.contact_shares (
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  shared_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (job_id, user_id)
);
alter table public.contact_shares enable row level security;

create or replace function public.share_phone(p_job uuid, p_share boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; uid uuid := auth.uid();
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not public.is_job_party(p_job) then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status in ('awaiting_payment','cancelled') then raise exception 'You can share your number once the job is paid.'; end if;
  if j.status in ('paid_out','refunded','split_resolved') and (j.completed_at is null or j.completed_at < now() - interval '24 hours') then raise exception 'This job is finished.'; end if;
  if p_share then
    insert into public.contact_shares (job_id, user_id) values (p_job, uid) on conflict (job_id, user_id) do update set shared_at = now(), revoked_at = null;
    insert into public.job_events (job_id, actor_id, event, note) values (p_job, uid, 'phone_shared', 'A phone number was shared for this job so you can reach each other on arrival.');
  else
    update public.contact_shares set revoked_at = now() where job_id = p_job and user_id = uid;
  end if;
end $$;

create or replace function public.job_view(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); j public.jobs%rowtype; pid uuid := public.my_provider_id();
        is_cust boolean; is_prov boolean; paid boolean;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null then return null; end if;
  is_cust := j.customer_id = uid; is_prov := (pid is not null and j.provider_id = pid);
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
    'location', case when paid and (is_cust or is_prov) then
        (select jsonb_build_object('lat', st_y(exact_location::geometry), 'lng', st_x(exact_location::geometry))
         from public.request_private where request_id = j.request_id and exact_location is not null) end,
    'door_code', case when is_cust then (select door_code from public.job_secrets where job_id = j.id) end,
    'milestones', (select coalesce(jsonb_agg(to_jsonb(m) order by m.position), '[]') from public.job_milestones m where m.job_id = j.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'note', e.note, 'at', e.created_at) order by e.created_at), '[]')
               from public.job_events e where e.job_id = j.id and e.event <> 'code_failed'),
    'provider', case when is_cust or public.is_staff() then
        (select jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', pr.avatar_path, 'rating', p.rating_avg,
                'rating_count', p.rating_count, 'jobs', p.jobs_completed, 'level', p.level, 'badges', public.provider_badges(p.id))
         from public.providers p join public.profiles pr on pr.id = p.user_id where p.id = j.provider_id) end,
    'customer', case when is_prov and paid then
        (select jsonb_build_object('first_name', split_part(coalesce(full_name, ''), ' ', 1)) from public.profiles where id = j.customer_id) end,
    'offer', (select jsonb_build_object('message', o.message, 'start_at', o.start_at) from public.offers o where o.id = j.offer_id),
    'my_review', (select jsonb_build_object('stars', rv.stars, 'comment', rv.comment) from public.reviews rv where rv.job_id = j.id and rv.reviewer_id = uid),
    'dispute', (select jsonb_build_object('id', d.id, 'status', d.status, 'reason', d.reason, 'resolution', d.resolution, 'note', d.resolved_note)
                from public.disputes d where d.job_id = j.id order by d.created_at desc limit 1),
    'contact', case when is_cust or is_prov then jsonb_build_object(
        'i_shared', exists (select 1 from public.contact_shares cs where cs.job_id = j.id and cs.user_id = uid and cs.revoked_at is null),
        'other_shared', exists (select 1 from public.contact_shares cs where cs.job_id = j.id and cs.user_id <> uid and cs.revoked_at is null),
        'other_phone', (select '+' || regexp_replace(pr.phone, '^\+', '') from public.contact_shares cs join public.profiles pr on pr.id = cs.user_id
                        where cs.job_id = j.id and cs.user_id <> uid and cs.revoked_at is null and paid
                          and (j.status not in ('paid_out','refunded','cancelled','split_resolved') or j.completed_at > now() - interval '24 hours'))) end,
    'trusted_contact', case when is_cust then
        (select jsonb_build_object('name', emergency_contact_name, 'phone', emergency_contact_phone) from public.profiles where id = uid) end
  );
end $$;

-- Null-safe party checks: a user with no provider profile must never match a job's provider
create or replace function public.open_dispute(p_job uuid, p_reason dispute_reason, p_detail text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; uid uuid := auth.uid(); pid uuid := public.my_provider_id(); other uuid;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not (j.customer_id = uid or (pid is not null and j.provider_id = pid)) then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status not in ('paid_held','on_the_way','arrived','working','completed_by_provider') then
    raise exception 'A problem can be reported while the job is paid and not yet confirmed.'; end if;
  if length(trim(coalesce(p_detail, ''))) < 15 then raise exception 'Describe what went wrong in at least a sentence.'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  insert into public.disputes (job_id, opened_by, reason, detail) values (j.id, uid, p_reason, trim(p_detail));
  update public.jobs set status = 'disputed' where id = j.id;
  insert into public.job_events (job_id, actor_id, event, note) values (j.id, uid, 'disputed', 'A problem was reported. Payment stays held while ConnectMe support reviews it.');
  select case when j.customer_id = uid then (select user_id from public.providers where id = j.provider_id) else j.customer_id end into other;
  insert into public.notifications (user_id, type, payload) values (other, 'dispute_opened', jsonb_build_object('job_id', j.id));
  perform set_config('app.bypass_guard', 'off', true);
end $$;

create or replace function public.job_quote(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; q public.quotes%rowtype; is_prov boolean; is_cust boolean; svc_mode text;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null then return null; end if;
  is_prov := (public.my_provider_id() is not null and j.provider_id = public.my_provider_id()); is_cust := j.customer_id = auth.uid();
  if not (is_prov or is_cust) then return null; end if;
  select s.pricing_mode into svc_mode from public.requests r join public.services s on s.id = r.service_id where r.id = j.request_id;
  select * into q from public.quotes where job_id = p_job or follow_up_job_id = p_job order by created_at desc limit 1;
  return jsonb_build_object('quote', case when q.id is not null then to_jsonb(q) end, 'is_quote_service', svc_mode = 'quote',
    'can_send', is_prov and svc_mode = 'quote' and j.status = 'paid_out' and (q.id is null or q.status in ('declined','expired')),
    'is_follow_up', q.id is not null and q.follow_up_job_id = p_job);
end $$;

-- =====================================================================
-- Ratings: tags, breakdown and a longer review list on the public profile
-- =====================================================================
drop function if exists public.submit_review(uuid, int, text);
create or replace function public.submit_review(p_job uuid, p_stars int, p_comment text, p_tags text[] default '{}') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; uid uuid := auth.uid(); pid uuid := public.my_provider_id(); reviewee uuid; prov_user uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not (j.customer_id = uid or (pid is not null and j.provider_id = pid)) then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status <> 'paid_out' then raise exception 'You can rate once the job is complete.'; end if;
  if p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars.'; end if;
  if public.contains_contact_info(p_comment) then raise exception 'Remove phone numbers or emails from your review.'; end if;
  if coalesce(array_length(p_tags, 1), 0) > 5 then raise exception 'Choose up to 5 tags.'; end if;
  if exists (select 1 from unnest(coalesce(p_tags, '{}')) t where t <> all (array['On time','Professional','Clean work','Fair price','Friendly','Skilled','Easy to deal with','Clear access','Late','Poor quality','Overpriced','Rude','Messy','No show'])) then
    raise exception 'Unknown tag.'; end if;
  if exists (select 1 from public.reviews where job_id = j.id and reviewer_id = uid) then raise exception 'You have already rated this job.'; end if;
  select user_id into prov_user from public.providers where id = j.provider_id;
  reviewee := case when j.customer_id = uid then prov_user else j.customer_id end;
  insert into public.reviews (job_id, reviewer_id, reviewee_id, stars, comment, tags) values (j.id, uid, reviewee, p_stars, nullif(trim(coalesce(p_comment, '')), ''), coalesce(p_tags, '{}'));
  if reviewee = prov_user then
    perform set_config('app.bypass_guard', 'on', true);
    update public.providers set
      rating_count = (select count(*) from public.reviews where reviewee_id = prov_user),
      rating_avg = (select round(avg(stars)::numeric, 2) from public.reviews where reviewee_id = prov_user)
    where id = j.provider_id;
    perform set_config('app.bypass_guard', 'off', true);
  end if;
  insert into public.notifications (user_id, type, payload) values (reviewee, 'review_received', jsonb_build_object('job_id', j.id, 'stars', p_stars, 'for', case when reviewee = prov_user then 'provider' else 'customer' end));
end $$;

create or replace function public.public_provider(p_provider uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.display_name, 'bio', p.bio, 'years', p.years_experience, 'avatar', pr.avatar_path,
    'rating', p.rating_avg, 'rating_count', p.rating_count, 'jobs', p.jobs_completed, 'level', p.level,
    'area', a.name, 'member_since', p.created_at, 'badges', public.provider_badges(p.id),
    'rating_breakdown', (select jsonb_build_object('5', count(*) filter (where stars = 5), '4', count(*) filter (where stars = 4), '3', count(*) filter (where stars = 3), '2', count(*) filter (where stars = 2), '1', count(*) filter (where stars = 1)) from public.reviews where reviewee_id = p.user_id),
    'top_tags', (select coalesce(jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc), '[]') from (select tag, count(*) n from public.reviews r, unnest(r.tags) tag where r.reviewee_id = p.user_id and r.stars >= 4 group by tag order by count(*) desc limit 4) t),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'typical_price_kobo', ps.typical_price_kobo)), '[]')
                 from public.provider_services ps join public.services s on s.id = ps.service_id
                 where ps.provider_id = p.id and ps.status = 'approved'),
    'portfolio', (select coalesce(jsonb_agg(jsonb_build_object('path', pi.photo_path, 'caption', pi.caption)), '[]')
                  from public.portfolio_items pi where pi.provider_id = p.id),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('stars', rv.stars, 'comment', rv.comment, 'at', rv.created_at, 'by', rv.by, 'tags', rv.tags, 'service', rv.service) order by rv.created_at desc), '[]')
                from (select r.stars, r.comment, r.created_at, r.tags, split_part(coalesce(c.full_name, 'Customer'), ' ', 1) as by,
                             (select s.name from public.jobs j join public.requests q on q.id = j.request_id join public.services s on s.id = q.service_id where j.id = r.job_id) as service
                      from public.reviews r join public.profiles c on c.id = r.reviewer_id
                      where r.reviewee_id = p.user_id order by r.created_at desc limit 30) rv))
  from public.providers p
  join public.profiles pr on pr.id = p.user_id
  left join public.areas a on a.id = p.base_area_id
  where p.id = p_provider and p.status in ('approved','suspended') and (p.status = 'approved' or p.user_id = auth.uid() or public.is_staff())
$$;

-- =====================================================================
-- Choose your providers: matching list shown to the customer before posting
-- =====================================================================
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
  where p.status = 'approved' and p.user_id <> auth.uid() and p.base_location is not null
    and st_dwithin(p.base_location, pt, p.radius_km * 1000)
    and (not coalesce(p_urgent, false) or p.available_today)
  order by 14 desc, 15 desc limit 20;
end $$;

drop function if exists public.create_request(text, jsonb, uuid, text, double precision, double precision, timestamptz, boolean, bigint, uuid);
create or replace function public.create_request(
  p_service_slug text, p_details jsonb, p_area_id uuid, p_address text, p_lat double precision, p_lng double precision,
  p_time_slot timestamptz, p_urgent boolean, p_budget_kobo bigint, p_preferred_provider uuid default null, p_invited uuid[] default null) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); svc public.services%rowtype; area_loc geography; req uuid; exp_h int; top_n int; same_day boolean;
        exact geography; approx geography; n int;
begin
  if uid is null then raise exception 'Sign in to post a request.' using errcode = '28000'; end if;
  if p_invited is not null and array_length(p_invited, 1) > 5 then raise exception 'Choose up to 5 providers, or send the request to everyone nearby.'; end if;
  if not exists (select 1 from public.profiles where id = uid and full_name is not null) then
    raise exception 'Add your full name before posting a request.'; end if;
  select * into svc from public.services where slug = p_service_slug and active;
  if svc.id is null then raise exception 'This service is not available yet.'; end if;
  select location into area_loc from public.areas where id = p_area_id and active;
  if area_loc is null then raise exception 'Choose the area where the work will happen.'; end if;
  if p_lat is null or p_lng is null or p_lat not between 3.5 and 14 or p_lng not between 2.5 and 15 then
    raise exception 'Drop a pin on the map where the work will happen.'; end if;
  exact := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  if st_distance(exact, area_loc) > 50000 then
    raise exception 'The pin is far from the area you chose. Choose the right area or move the pin.'; end if;
  approx := st_setsrid(st_makepoint(round(p_lng::numeric, 2)::float8, round(p_lat::numeric, 2)::float8), 4326)::geography;
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
  values (uid, svc.id, p_details, p_area_id, approx, p_time_slot, p_urgent, p_budget_kobo, 'open', now() + make_interval(hours => coalesce(exp_h, 24)))
  returning id into req;
  insert into public.request_private (request_id, address_text, exact_location) values (req, trim(p_address), exact);

  insert into public.request_recipients (request_id, provider_id)
  select req, p.id
  from public.providers p
  join public.provider_services ps on ps.provider_id = p.id and ps.service_id = svc.id and ps.status = 'approved'
  where p.status = 'approved' and p.user_id <> uid and p.base_location is not null
    and (p_preferred_provider is null or p.id = p_preferred_provider)
    and (p_invited is null or p.id = any(p_invited))
    and st_dwithin(p.base_location, approx, p.radius_km * 1000)
    and (not same_day or p.available_today)
  order by public.rank_score(case when p.rating_count = 0 then 4.0 else p.rating_avg end,
                             st_distance(p.base_location, approx) / 1000.0, p.radius_km, p.jobs_completed, p.response_rate) desc
  limit coalesce(top_n, 10);
  get diagnostics n = row_count;
  if (p_preferred_provider is not null or p_invited is not null) and n = 0 then
    raise exception 'This provider is not available for your request right now. Post it to everyone nearby instead, or try another time.';
  end if;

  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'new_request', jsonb_build_object('request_id', req, 'service', svc.name)
  from public.request_recipients rr join public.providers p on p.id = rr.provider_id where rr.request_id = req;
  perform set_config('app.bypass_guard', 'off', true);
  return req;
end $$;

-- =====================================================================
-- Provider profile changes that need approval (area, new service, profile photo)
-- =====================================================================
create table if not exists public.provider_change_requests (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  kind text not null check (kind in ('area','service','photo')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.provider_change_requests enable row level security;
create policy changes_select on public.provider_change_requests for select to authenticated using (provider_id = public.my_provider_id() or public.is_staff());

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
      'current_avatar', (select avatar_path from public.profiles where id = p.user_id)) as x
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
    elsif c.kind = 'photo' then update public.profiles set avatar_path = c.payload->>'avatar_path' where id = p.user_id;
    end if;
  end if;
  update public.provider_change_requests set status = case when p_approve then 'approved' else 'rejected' end, note = nullif(trim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now() where id = c.id;
  insert into public.notifications (user_id, type, payload) values (p.user_id, case when p_approve then 'change_approved' else 'change_rejected' end, jsonb_build_object('kind', c.kind, 'reason', nullif(trim(coalesce(p_note, '')), '')));
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Admin monitoring: customers, requests, offers, jobs (support and admin roles)
-- =====================================================================
create or replace function public.admin_customers(p_query text) returns table(
  user_id uuid, name text, phone text, created_at timestamptz, suspended boolean, requests int, jobs int, disputes int, spent_kobo bigint, is_provider boolean)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.full_name, p.phone, p.created_at, p.suspended_at is not null,
         (select count(*)::int from public.requests r where r.customer_id = p.id),
         (select count(*)::int from public.jobs j where j.customer_id = p.id),
         (select count(*)::int from public.disputes d join public.jobs j on j.id = d.job_id where j.customer_id = p.id),
         coalesce((select sum(m.amount_kobo) from public.job_milestones m join public.jobs j on j.id = m.job_id where j.customer_id = p.id and m.status in ('paid_held','released')), 0)::bigint,
         exists (select 1 from public.providers pv where pv.user_id = p.id)
  from public.profiles p
  where public.is_support()
    and (coalesce(trim(p_query), '') = '' or p.full_name ilike '%' || trim(p_query) || '%'
         or (regexp_replace(coalesce(p_query, ''), '\D', '', 'g') <> '' and p.phone like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'))
  order by p.created_at desc limit 100
$$;

create or replace function public.admin_customer_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_support() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', id, 'name', full_name, 'phone', phone, 'created_at', created_at, 'suspended_at', suspended_at, 'suspended_reason', suspended_reason, 'avatar', avatar_path) from public.profiles where id = p_user),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'service', s.name, 'status', r.status, 'created_at', r.created_at, 'offers', (select count(*) from public.offers o where o.request_id = r.id)) order by r.created_at desc), '[]')
                 from (select * from public.requests where customer_id = p_user order by created_at desc limit 30) r join public.services s on s.id = r.service_id),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'service', s.name, 'status', j.status, 'total_kobo', j.total_kobo, 'provider', pv.display_name, 'created_at', j.created_at) order by j.created_at desc), '[]')
             from (select * from public.jobs where customer_id = p_user order by created_at desc limit 30) j join public.requests r on r.id = j.request_id join public.services s on s.id = r.service_id join public.providers pv on pv.id = j.provider_id),
    'disputes', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'job_id', d.job_id, 'reason', d.reason, 'status', d.status, 'created_at', d.created_at) order by d.created_at desc), '[]')
                 from public.disputes d join public.jobs j on j.id = d.job_id where j.customer_id = p_user));
end $$;

create or replace function public.admin_requests(p_query text, p_status text) returns table(
  request_id uuid, service_name text, customer_name text, area_name text, status text, created_at timestamptz, expires_at timestamptz, urgent boolean, budget_kobo bigint, offers_count int, notified_count int, job_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, s.name, c.full_name, a.name,
         case when r.status in ('open','offers_received') and r.expires_at < now() then 'expired' else r.status::text end,
         r.created_at, r.expires_at, r.urgent, r.budget_kobo,
         (select count(*)::int from public.offers o where o.request_id = r.id),
         (select count(*)::int from public.request_recipients rr where rr.request_id = r.id),
         (select j.id from public.jobs j where j.request_id = r.id)
  from public.requests r join public.services s on s.id = r.service_id join public.profiles c on c.id = r.customer_id left join public.areas a on a.id = r.area_id
  where public.is_support()
    and (coalesce(p_status, 'all') = 'all' or (case when r.status in ('open','offers_received') and r.expires_at < now() then 'expired' else r.status::text end) = p_status)
    and (coalesce(trim(p_query), '') = '' or c.full_name ilike '%' || trim(p_query) || '%' or s.name ilike '%' || trim(p_query) || '%'
         or (regexp_replace(coalesce(p_query, ''), '\D', '', 'g') <> '' and c.phone like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'))
  order by r.created_at desc limit 100
$$;

create or replace function public.admin_request_detail(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r public.requests%rowtype;
begin
  if not public.is_support() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into r from public.requests where id = p_request;
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'request', jsonb_build_object('id', r.id, 'status', r.status, 'details', r.details, 'urgent', r.urgent, 'time_slot', r.time_slot, 'budget_kobo', r.budget_kobo, 'created_at', r.created_at, 'expires_at', r.expires_at),
    'service', (select jsonb_build_object('name', name, 'form_schema', form_schema) from public.services where id = r.service_id),
    'customer', (select jsonb_build_object('id', id, 'name', full_name, 'phone', phone) from public.profiles where id = r.customer_id),
    'area', (select name from public.areas where id = r.area_id),
    'address', (select address_text from public.request_private where request_id = r.id),
    'notified', (select count(*) from public.request_recipients where request_id = r.id),
    'viewed', (select count(*) from public.request_recipients where request_id = r.id and viewed_at is not null),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'provider_id', p.id, 'provider', p.display_name, 'price_kobo', o.price_kobo, 'message', o.message, 'status', o.status, 'created_at', o.created_at, 'start_at', o.start_at, 'rating', p.rating_avg) order by o.created_at), '[]')
               from public.offers o join public.providers p on p.id = o.provider_id where o.request_id = r.id),
    'job_id', (select id from public.jobs where request_id = r.id));
end $$;

create or replace function public.admin_jobs(p_query text, p_status text) returns table(
  job_id uuid, service_name text, customer_name text, provider_name text, total_kobo bigint, status text, created_at timestamptz, has_dispute boolean)
language sql stable security definer set search_path = public, extensions as $$
  select j.id, s.name, c.full_name, p.display_name, j.total_kobo, j.status::text, j.created_at, exists (select 1 from public.disputes d where d.job_id = j.id)
  from public.jobs j join public.requests r on r.id = j.request_id join public.services s on s.id = r.service_id
  join public.profiles c on c.id = j.customer_id join public.providers p on p.id = j.provider_id
  where public.is_support() and (coalesce(p_status, 'all') = 'all' or j.status::text = p_status)
    and (coalesce(trim(p_query), '') = '' or c.full_name ilike '%' || trim(p_query) || '%' or p.display_name ilike '%' || trim(p_query) || '%' or s.name ilike '%' || trim(p_query) || '%'
         or j.id::text like trim(p_query) || '%' or (regexp_replace(coalesce(p_query, ''), '\D', '', 'g') <> '' and (c.phone like '%' || regexp_replace(p_query, '\D', '', 'g') || '%')))
  order by j.created_at desc limit 100
$$;

-- Everything about one job for support. Chat is shown only when a problem has been reported, and each view is logged.
create or replace function public.admin_job_detail(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; has_dispute boolean; msgs jsonb := null;
begin
  if not public.is_support() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then return null; end if;
  select exists (select 1 from public.disputes where job_id = j.id) into has_dispute;
  if has_dispute then
    select coalesce(jsonb_agg(jsonb_build_object('from', case when m.sender_id = j.customer_id then 'customer' else 'provider' end, 'body', m.body, 'at', m.created_at) order by m.created_at), '[]') into msgs from public.messages m where m.job_id = j.id;
    insert into public.audit_log (actor_id, action, entity, entity_id) values (auth.uid(), 'admin_viewed_job_chat', 'jobs', j.id::text);
  end if;
  return jsonb_build_object(
    'job', to_jsonb(j) - 'offer_id',
    'service', (select s.name from public.requests r join public.services s on s.id = r.service_id where r.id = j.request_id),
    'request_id', j.request_id,
    'customer', (select jsonb_build_object('id', id, 'name', full_name, 'phone', phone) from public.profiles where id = j.customer_id),
    'provider', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'phone', pr.phone, 'rating', p.rating_avg) from public.providers p join public.profiles pr on pr.id = p.user_id where p.id = j.provider_id),
    'address', (select address_text from public.request_private where request_id = j.request_id),
    'milestones', (select coalesce(jsonb_agg(to_jsonb(m) order by m.position), '[]') from public.job_milestones m where m.job_id = j.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('reference', pay.reference, 'amount_kobo', pay.amount_kobo, 'status', pay.status, 'provider', pay.provider, 'fee_kobo', pay.fee_kobo, 'paid_at', pay.paid_at) order by pay.created_at), '[]')
                 from public.payments pay join public.job_milestones m on m.id = pay.milestone_id where m.job_id = j.id),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('net_kobo', po.net_kobo, 'commission_kobo', po.commission_kobo, 'status', po.status, 'processed_at', po.processed_at)), '[]') from public.payouts po join public.job_milestones m on m.id = po.milestone_id where m.job_id = j.id),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('amount_kobo', rf.amount_kobo, 'reason', rf.reason, 'status', rf.status)), '[]') from public.refunds rf join public.job_milestones m on m.id = rf.milestone_id where m.job_id = j.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'note', e.note, 'at', e.created_at) order by e.created_at), '[]') from public.job_events e where e.job_id = j.id),
    'dispute', (select jsonb_build_object('id', d.id, 'status', d.status, 'reason', d.reason, 'detail', d.detail, 'resolution', d.resolution) from public.disputes d where d.job_id = j.id order by d.created_at desc limit 1),
    'messages', msgs, 'messages_hidden', not has_dispute);
end $$;

-- =====================================================================
-- Permissions
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any(array[
             'is_support','admin_set_customer_status','share_phone','job_view','submit_review','open_dispute','job_quote','public_provider','match_providers','create_request',
             'request_provider_change','admin_provider_changes','admin_decide_change','admin_customers','admin_customer_detail','admin_requests','admin_request_detail','admin_jobs','admin_job_detail'])
  loop execute format('revoke execute on function %s from public, anon', f.sig); execute format('grant execute on function %s to authenticated', f.sig); end loop;
end $$;
