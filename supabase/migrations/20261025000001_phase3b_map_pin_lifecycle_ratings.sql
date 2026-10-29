-- Phase 3b: map pin for the job address, job lifecycle (test mode), confirmation, ratings, disputes, past providers.
-- Safe to run after 20261024000001. Run it once in the Supabase SQL editor.

-- ---------------------------------------------------------------------
-- Account: trusted contact for "share my booking"
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists emergency_contact_name text,
                            add column if not exists emergency_contact_phone text;

create or replace function public.list_areas() returns table(id uuid, name text, city text, lat double precision, lng double precision)
language sql stable set search_path = public, extensions as $$
  select a.id, a.name, a.city, st_y(a.location::geometry), st_x(a.location::geometry)
  from public.areas a where a.active order by a.city, a.name
$$;

-- ---------------------------------------------------------------------
-- Requests now carry a pin on the map
-- ---------------------------------------------------------------------
drop function if exists public.create_request(text, jsonb, uuid, text, timestamptz, boolean, bigint);
create or replace function public.create_request(
  p_service_slug text, p_details jsonb, p_area_id uuid, p_address text, p_lat double precision, p_lng double precision,
  p_time_slot timestamptz, p_urgent boolean, p_budget_kobo bigint, p_preferred_provider uuid default null) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); svc public.services%rowtype; area_loc geography; req uuid; exp_h int; top_n int; same_day boolean;
        exact geography; approx geography; n int;
begin
  if uid is null then raise exception 'Sign in to post a request.' using errcode = '28000'; end if;
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
    and st_dwithin(p.base_location, approx, p.radius_km * 1000)
    and (not same_day or p.available_today)
  order by public.rank_score(case when p.rating_count = 0 then 4.0 else p.rating_avg end,
                             st_distance(p.base_location, approx) / 1000.0, p.radius_km, p.jobs_completed, p.response_rate) desc
  limit coalesce(top_n, 10);
  get diagnostics n = row_count;
  if p_preferred_provider is not null and n = 0 then
    raise exception 'This provider is not available for your request right now. Post it to everyone nearby instead, or try another time.';
  end if;

  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'new_request', jsonb_build_object('request_id', req, 'service', svc.name)
  from public.request_recipients rr join public.providers p on p.id = rr.provider_id where rr.request_id = req;
  perform set_config('app.bypass_guard', 'off', true);
  return req;
end $$;

-- Offers: distance now comes from the pin
create or replace function public.request_offers(p_request uuid) returns table(
  offer_id uuid, provider_id uuid, price_kobo bigint, start_at timestamptz, message text, created_at timestamptz,
  offer_status offer_status, display_name text, avatar_path text, rating_avg numeric, rating_count int,
  jobs_completed int, years_experience int, level smallint, distance_km numeric, badges text[], match_score numeric)
language sql stable security definer set search_path = public, extensions as $$
  select o.id, p.id, o.price_kobo, o.start_at, o.message, o.created_at, o.status, p.display_name, pr.avatar_path,
         p.rating_avg, p.rating_count, p.jobs_completed, p.years_experience, p.level,
         round((st_distance(p.base_location, r.approx_location) / 1000.0)::numeric, 1),
         public.provider_badges(p.id),
         round(public.rank_score(case when p.rating_count = 0 then 4.0 else p.rating_avg end,
               st_distance(p.base_location, r.approx_location) / 1000.0, p.radius_km, p.jobs_completed, p.response_rate)::numeric, 2)
  from public.offers o
  join public.requests r on r.id = o.request_id
  join public.providers p on p.id = o.provider_id
  join public.profiles pr on pr.id = p.user_id
  where o.request_id = p_request and r.customer_id = auth.uid() and o.status in ('sent','accepted')
  order by 17 desc, o.created_at
$$;

-- ---------------------------------------------------------------------
-- Job view: location, reviews, disputes, trusted contact
-- ---------------------------------------------------------------------
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
    'trusted_contact', case when is_cust then
        (select jsonb_build_object('name', emergency_contact_name, 'phone', emergency_contact_phone) from public.profiles where id = uid) end
  );
end $$;

-- ---------------------------------------------------------------------
-- Test-mode payment for any milestone (replaced by Paystack in Phase 4)
-- ---------------------------------------------------------------------
create or replace function public.test_pay_next_milestone(p_job uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; enabled boolean; m public.job_milestones%rowtype;
begin
  select (value::text = 'true') into enabled from public.settings where key = 'test_payments';
  if not coalesce(enabled, false) then raise exception 'Test payments are switched off.'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or j.customer_id is distinct from auth.uid() then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status not in ('awaiting_payment','paid_held','on_the_way','arrived','working','completed_by_provider') then
    raise exception 'This job can no longer be paid.'; end if;
  select * into m from public.job_milestones where job_id = j.id and status = 'pending' order by position limit 1;
  if m.id is null then raise exception 'Everything on this job is already paid.'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  update public.job_milestones set status = 'paid_held' where id = m.id;
  if j.status = 'awaiting_payment' then
    update public.jobs set status = 'paid_held' where id = j.id;
    insert into public.notifications (user_id, type, payload)
    select p.user_id, 'job_paid', jsonb_build_object('job_id', j.id) from public.providers p where p.id = j.provider_id;
  end if;
  insert into public.job_events (job_id, actor_id, event, note)
  values (j.id, auth.uid(), 'payment_held', m.label || ': NGN ' || to_char(m.amount_kobo / 100, 'FM999,999,999') || ' paid and held by ConnectMe (test mode).');
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- Provider moves the job forward. Starting work needs the customer's door code.
-- Returns 'ok', 'wrong_code' or 'locked'.
-- ---------------------------------------------------------------------
create or replace function public.provider_advance_job(p_job uuid, p_to text, p_code text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; pid uuid := public.my_provider_id(); expected text; code text; fails int; pname text; note text;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or pid is null or j.provider_id <> pid then raise exception 'Job not found.' using errcode = '42501'; end if;
  expected := case j.status::text when 'paid_held' then 'on_the_way' when 'on_the_way' then 'arrived'
                when 'arrived' then 'working' when 'working' then 'completed_by_provider' else null end;
  if expected is null or expected <> p_to then raise exception 'That step is not available yet.'; end if;
  select display_name into pname from public.providers where id = pid;

  if p_to = 'working' then
    select count(*) into fails from public.job_events where job_id = j.id and event = 'code_failed';
    if fails >= 5 then return 'locked'; end if;
    select door_code into code from public.job_secrets where job_id = j.id;
    if coalesce(p_code, '') <> code then
      perform set_config('app.bypass_guard', 'on', true);
      insert into public.job_events (job_id, actor_id, event, note) values (j.id, auth.uid(), 'code_failed', 'A wrong door code was entered.');
      perform set_config('app.bypass_guard', 'off', true);
      return case when fails + 1 >= 5 then 'locked' else 'wrong_code' end;
    end if;
  end if;

  note := case p_to when 'on_the_way' then pname || ' is on the way.'
                    when 'arrived' then pname || ' has arrived.'
                    when 'working' then 'Door code confirmed. Work has started.'
                    else pname || ' marked the work complete. Please check it and confirm.' end;
  perform set_config('app.bypass_guard', 'on', true);
  update public.jobs set status = p_to::job_status where id = j.id;
  insert into public.job_events (job_id, actor_id, event, note) values (j.id, auth.uid(), p_to, note);
  insert into public.notifications (user_id, type, payload)
  values (j.customer_id, 'job_update', jsonb_build_object('job_id', j.id, 'status', p_to, 'provider', pname));
  perform set_config('app.bypass_guard', 'off', true);
  return 'ok';
end $$;

-- ---------------------------------------------------------------------
-- Customer confirms the work: money is released to the provider minus commission
-- ---------------------------------------------------------------------
create or replace function public.release_milestones(p_job uuid, p_new_status job_status, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; m record; comm bigint; total_net bigint := 0;
begin
  select * into j from public.jobs where id = p_job;
  for m in select * from public.job_milestones where job_id = p_job and status = 'paid_held' loop
    comm := round(m.amount_kobo * j.commission_bps / 10000.0);
    insert into public.payouts (milestone_id, provider_id, gross_kobo, commission_kobo, net_kobo)
    values (m.id, j.provider_id, m.amount_kobo, comm, m.amount_kobo - comm) on conflict (milestone_id) do nothing;
    update public.job_milestones set status = 'released' where id = m.id;
    total_net := total_net + (m.amount_kobo - comm);
  end loop;
  update public.jobs set status = p_new_status, completed_at = now() where id = p_job;
  update public.providers set jobs_completed = jobs_completed + 1 where id = j.provider_id;
  insert into public.job_events (job_id, actor_id, event, note) values (p_job, auth.uid(), 'paid_out', p_note);
  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'payment_released', jsonb_build_object('job_id', p_job, 'net_kobo', total_net) from public.providers p where p.id = j.provider_id;
end $$;

create or replace function public.customer_confirm_job(p_job uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; owing bigint;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or j.customer_id is distinct from auth.uid() then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status <> 'completed_by_provider' then raise exception 'You can confirm once the provider marks the work complete.'; end if;
  select coalesce(sum(amount_kobo), 0) into owing from public.job_milestones where job_id = j.id and status = 'pending';
  if owing > 0 then raise exception 'Pay the remaining NGN % before confirming, so the provider can be paid in full.', to_char(owing / 100, 'FM999,999,999'); end if;
  perform set_config('app.bypass_guard', 'on', true);
  perform public.release_milestones(j.id, 'paid_out', 'You confirmed the work. Payment released to the provider.');
  perform set_config('app.bypass_guard', 'off', true);
end $$;
revoke execute on function public.release_milestones(uuid, job_status, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Ratings
-- ---------------------------------------------------------------------
create or replace function public.submit_review(p_job uuid, p_stars int, p_comment text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; uid uuid := auth.uid(); pid uuid := public.my_provider_id(); reviewee uuid; prov_user uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not (j.customer_id = uid or j.provider_id = pid) then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status <> 'paid_out' then raise exception 'You can rate once the job is complete.'; end if;
  if p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars.'; end if;
  if public.contains_contact_info(p_comment) then raise exception 'Remove phone numbers or emails from your review.'; end if;
  if exists (select 1 from public.reviews where job_id = j.id and reviewer_id = uid) then raise exception 'You have already rated this job.'; end if;
  select user_id into prov_user from public.providers where id = j.provider_id;
  reviewee := case when j.customer_id = uid then prov_user else j.customer_id end;
  insert into public.reviews (job_id, reviewer_id, reviewee_id, stars, comment) values (j.id, uid, reviewee, p_stars, nullif(trim(coalesce(p_comment, '')), ''));
  if reviewee = prov_user then
    perform set_config('app.bypass_guard', 'on', true);
    update public.providers set
      rating_count = (select count(*) from public.reviews where reviewee_id = prov_user),
      rating_avg = (select round(avg(stars)::numeric, 2) from public.reviews where reviewee_id = prov_user)
    where id = j.provider_id;
    perform set_config('app.bypass_guard', 'off', true);
  end if;
  insert into public.notifications (user_id, type, payload) values (reviewee, 'review_received', jsonb_build_object('job_id', j.id, 'stars', p_stars));
end $$;

-- ---------------------------------------------------------------------
-- Disputes: payment stays held while support decides
-- ---------------------------------------------------------------------
create or replace function public.open_dispute(p_job uuid, p_reason dispute_reason, p_detail text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; uid uuid := auth.uid(); pid uuid := public.my_provider_id(); other uuid;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not (j.customer_id = uid or j.provider_id = pid) then raise exception 'Job not found.' using errcode = '42501'; end if;
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

create or replace function public.admin_disputes() returns table(
  dispute_id uuid, job_id uuid, service_name text, customer_name text, provider_name text, reason dispute_reason, detail text,
  opened_by_role text, held_kobo bigint, created_at timestamptz, dispute_status dispute_status, resolution text, resolved_note text)
language sql stable security definer set search_path = public, extensions as $$
  select d.id, j.id, s.name, c.full_name, p.display_name, d.reason, d.detail,
         case when d.opened_by = j.customer_id then 'customer' else 'provider' end,
         coalesce((select sum(m.amount_kobo) from public.job_milestones m where m.job_id = j.id and m.status = 'paid_held'), 0)::bigint,
         d.created_at, d.status, d.resolution, d.resolved_note
  from public.disputes d
  join public.jobs j on j.id = d.job_id
  join public.requests r on r.id = j.request_id
  join public.services s on s.id = r.service_id
  join public.profiles c on c.id = j.customer_id
  join public.providers p on p.id = j.provider_id
  where (public.has_role('support') or public.is_admin())
  order by (d.status = 'open') desc, d.created_at desc
$$;

create or replace function public.admin_resolve_dispute(p_dispute uuid, p_resolution text, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare d public.disputes%rowtype; j public.jobs%rowtype; m record; refund bigint; prov_gross bigint; comm bigint; final job_status; prov_user uuid;
begin
  if not (public.has_role('support') or public.is_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_resolution not in ('refund_customer','pay_provider','split_50_50') then raise exception 'Unknown outcome.'; end if;
  if length(trim(coalesce(p_note, ''))) < 10 then raise exception 'Write a clear note explaining the decision. Both people will see it.'; end if;
  select * into d from public.disputes where id = p_dispute for update;
  if d.id is null or d.status <> 'open' then raise exception 'This dispute is already resolved.'; end if;
  select * into j from public.jobs where id = d.job_id for update;
  perform set_config('app.bypass_guard', 'on', true);
  for m in select * from public.job_milestones where job_id = j.id and status = 'paid_held' loop
    if p_resolution = 'refund_customer' then
      insert into public.refunds (milestone_id, amount_kobo, reason) values (m.id, m.amount_kobo, 'Dispute resolved in customer''s favour');
      update public.job_milestones set status = 'refunded' where id = m.id;
    else
      refund := case when p_resolution = 'split_50_50' then m.amount_kobo / 2 else 0 end;
      prov_gross := m.amount_kobo - refund;
      comm := round(prov_gross * j.commission_bps / 10000.0);
      if refund > 0 then insert into public.refunds (milestone_id, amount_kobo, reason) values (m.id, refund, 'Dispute split 50/50'); end if;
      insert into public.payouts (milestone_id, provider_id, gross_kobo, commission_kobo, net_kobo)
      values (m.id, j.provider_id, prov_gross, comm, prov_gross - comm) on conflict (milestone_id) do nothing;
      update public.job_milestones set status = 'released' where id = m.id;
    end if;
  end loop;
  final := case p_resolution when 'refund_customer' then 'refunded' when 'pay_provider' then 'paid_out' else 'split_resolved' end;
  update public.jobs set status = final, completed_at = now() where id = j.id;
  if p_resolution <> 'refund_customer' then update public.providers set jobs_completed = jobs_completed + 1 where id = j.provider_id; end if;
  update public.disputes set status = 'resolved', resolution = p_resolution, resolved_by = auth.uid(), resolved_note = trim(p_note) where id = d.id;
  insert into public.job_events (job_id, actor_id, event, note) values (j.id, auth.uid(), 'dispute_resolved',
    case p_resolution when 'refund_customer' then 'Resolved: the customer was refunded.' when 'pay_provider' then 'Resolved: the provider was paid.' else 'Resolved: the payment was split 50/50.' end);
  select user_id into prov_user from public.providers where id = j.provider_id;
  insert into public.notifications (user_id, type, payload)
  select u, 'dispute_resolved', jsonb_build_object('job_id', j.id, 'resolution', p_resolution, 'note', trim(p_note)) from unnest(array[j.customer_id, prov_user]) u;
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- My jobs (with rating state) and providers I have worked with
-- ---------------------------------------------------------------------
drop function if exists public.my_jobs();
create or replace function public.my_jobs() returns table(
  job_id uuid, role text, service_name text, counterpart text, total_kobo bigint, status job_status, area_name text,
  created_at timestamptz, provider_id uuid, reviewed boolean, my_stars smallint)
language sql stable security definer set search_path = public, extensions as $$
  select j.id, case when j.customer_id = auth.uid() then 'customer' else 'provider' end, s.name,
         case when j.customer_id = auth.uid() then p.display_name
              when j.status = 'awaiting_payment' then 'Customer'
              else coalesce(nullif(split_part(coalesce(c.full_name, ''), ' ', 1), ''), 'Customer') end,
         j.total_kobo, j.status, a.name, j.created_at, p.id,
         exists (select 1 from public.reviews rv where rv.job_id = j.id and rv.reviewer_id = auth.uid()),
         (select rv.stars from public.reviews rv where rv.job_id = j.id and rv.reviewer_id = auth.uid())
  from public.jobs j
  join public.requests r on r.id = j.request_id
  join public.services s on s.id = r.service_id
  join public.providers p on p.id = j.provider_id
  join public.profiles c on c.id = j.customer_id
  left join public.areas a on a.id = r.area_id
  where j.customer_id = auth.uid() or p.user_id = auth.uid()
  order by j.created_at desc limit 100
$$;

create or replace function public.my_providers() returns table(
  provider_id uuid, name text, avatar_path text, services text[], service_slugs text[], jobs_together int, last_job_at timestamptz,
  my_stars smallint, rating_avg numeric, rating_count int, level smallint)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.display_name, pr.avatar_path,
         array_agg(distinct s.name), array_agg(distinct s.slug), count(*)::int, max(j.created_at),
         (select rv.stars from public.reviews rv join public.jobs j2 on j2.id = rv.job_id
           where rv.reviewer_id = auth.uid() and j2.provider_id = p.id order by rv.created_at desc limit 1),
         p.rating_avg, p.rating_count, p.level
  from public.jobs j
  join public.providers p on p.id = j.provider_id and p.status = 'approved'
  join public.profiles pr on pr.id = p.user_id
  join public.requests r on r.id = j.request_id
  join public.services s on s.id = r.service_id
  where j.customer_id = auth.uid() and j.status in ('paid_out','split_resolved')
  group by p.id, p.display_name, pr.avatar_path, p.rating_avg, p.rating_count, p.level
  order by max(j.created_at) desc
$$;

-- Public profile now names the service slug and the reviewer's first name
create or replace function public.public_provider(p_provider uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.display_name, 'bio', p.bio, 'years', p.years_experience, 'avatar', pr.avatar_path,
    'rating', p.rating_avg, 'rating_count', p.rating_count, 'jobs', p.jobs_completed, 'level', p.level,
    'area', a.name, 'member_since', p.created_at, 'badges', public.provider_badges(p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'typical_price_kobo', ps.typical_price_kobo)), '[]')
                 from public.provider_services ps join public.services s on s.id = ps.service_id
                 where ps.provider_id = p.id and ps.status = 'approved'),
    'portfolio', (select coalesce(jsonb_agg(jsonb_build_object('path', pi.photo_path, 'caption', pi.caption)), '[]')
                  from public.portfolio_items pi where pi.provider_id = p.id),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('stars', rv.stars, 'comment', rv.comment, 'at', rv.created_at, 'by', rv.by)), '[]')
                from (select r.stars, r.comment, r.created_at, split_part(coalesce(c.full_name, 'Customer'), ' ', 1) as by
                      from public.reviews r join public.profiles c on c.id = r.reviewer_id
                      where r.reviewee_id = p.user_id order by r.created_at desc limit 10) rv))
  from public.providers p
  join public.profiles pr on pr.id = p.user_id
  left join public.areas a on a.id = p.base_area_id
  where p.id = p_provider and p.status = 'approved'
$$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.create_request(text, jsonb, uuid, text, double precision, double precision, timestamptz, boolean, bigint, uuid),
  public.test_pay_next_milestone(uuid), public.provider_advance_job(uuid, text, text), public.customer_confirm_job(uuid),
  public.submit_review(uuid, int, text), public.open_dispute(uuid, dispute_reason, text), public.admin_disputes(),
  public.admin_resolve_dispute(uuid, text, text), public.my_jobs(), public.my_providers(), public.list_areas() from public, anon;
grant execute on function public.create_request(text, jsonb, uuid, text, double precision, double precision, timestamptz, boolean, bigint, uuid),
  public.test_pay_next_milestone(uuid), public.provider_advance_job(uuid, text, text), public.customer_confirm_job(uuid),
  public.submit_review(uuid, int, text), public.open_dispute(uuid, dispute_reason, text), public.admin_disputes(),
  public.admin_resolve_dispute(uuid, text, text), public.my_jobs(), public.my_providers(), public.list_areas() to authenticated;
grant execute on function public.job_view(uuid), public.request_offers(uuid), public.public_provider(uuid) to authenticated;
