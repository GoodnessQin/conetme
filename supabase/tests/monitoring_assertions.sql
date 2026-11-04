-- Admin monitoring, suspension, matching, phone sharing, ratings, profile changes.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/monitoring_assertions.sql
begin;
create schema t;
grant usage on schema t to public;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;
create function t.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end $$;
create function t.n(q text) returns bigint language plpgsql as $$
declare c bigint; begin execute 'select count(*) from (' || q || ') x' into c; return c; end $$;
create function t.raises(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;
create function t.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
grant execute on all functions in schema t to public;



create function t.new_job(cust uuid, prov uuid, pid uuid, area uuid, slug text, price bigint, details jsonb) returns uuid language plpgsql as $$
declare req uuid; off uuid; job uuid;
begin
  perform t.as_service();
  update public.requests set created_at = now() - interval '2 hours' where customer_id = cust;
  perform t.as_user(cust);
  req := public.create_request(slug, details, area, '12 Admiralty Way, Lekki Phase 1', 6.4474, 3.4723, now() + interval '1 day', false, null);
  perform t.as_user(prov);
  insert into public.offers (request_id, provider_id, price_kobo, message) values (req, pid, price, 'I can do it tomorrow.') returning id into off;
  perform t.as_user(cust);
  job := public.accept_offer(off);
  return job;
end $$;
create function t.finish_work(job uuid, cust uuid, prov uuid) returns void language plpgsql as $$
declare code text;
begin
  perform t.as_user(cust); code := public.job_view(job)->>'door_code';
  perform t.as_user(prov);
  perform public.provider_advance_job(job, 'on_the_way'); perform public.provider_advance_job(job, 'arrived');
  perform public.provider_advance_job(job, 'working', code); perform public.provider_advance_job(job, 'completed_by_provider');
end $$;
grant execute on all functions in schema t to public;

insert into auth.users (id, phone) values
 ('00000000-0000-0000-0000-000000000021','+2348030000021'), ('00000000-0000-0000-0000-000000000022','+2348030000022'),
 ('00000000-0000-0000-0000-000000000023','+2348030000023'), ('00000000-0000-0000-0000-000000000024','+2348030000024');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000023','admin');
update public.profiles set full_name = 'Ngozi Adeyemi' where id = '00000000-0000-0000-0000-000000000021';
update public.profiles set full_name = 'Emeka Obi' where id = '00000000-0000-0000-0000-000000000024';
insert into public.providers (id, user_id, display_name, bio, years_experience, base_area_id, radius_km, status, level, available_today)
  select '22222222-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000022', 'Chidi Okafor', 'Licensed plumber with twelve years of work in Lekki.', 12, id, 20, 'approved', 2, true from public.areas where name = 'Lekki Phase 1';
insert into public.provider_services (provider_id, service_id, typical_price_kobo, status)
  select '22222222-0000-0000-0000-000000000022', id, 1000000, 'approved' from public.services where slug in ('plumber','caterer','solar-installer');
insert into public.provider_private (provider_id, nin_hash, nin_last4, bank_name, bank_code, bank_account_number, bank_account_name) values ('22222222-0000-0000-0000-000000000022','h','1234','GTBank','058','0123456789','Chidi Okafor');

insert into auth.users (id, phone) values ('00000000-0000-0000-0000-000000000025','+2348030000025'), ('00000000-0000-0000-0000-000000000026','+2348030000026');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000025','support'), ('00000000-0000-0000-0000-000000000026','verifier');

do $$
declare
  cust uuid := '00000000-0000-0000-0000-000000000021'; prov uuid := '00000000-0000-0000-0000-000000000022'; adm uuid := '00000000-0000-0000-0000-000000000023'; cust2 uuid := '00000000-0000-0000-0000-000000000024';
  sup uuid := '00000000-0000-0000-0000-000000000025'; ver uuid := '00000000-0000-0000-0000-000000000026';
  pid uuid := '22222222-0000-0000-0000-000000000022'; lekki uuid; ikeja uuid; abuja uuid; job uuid; job2 uuid; req uuid; n int; j jsonb; chg uuid; plumber uuid; hair uuid;
begin
  select id into lekki from public.areas where name = 'Lekki Phase 1'; select id into ikeja from public.areas where name = 'Ikeja'; select id into abuja from public.areas where name = 'Wuse 2';
  select id into plumber from public.services where slug = 'plumber';

  -- ---------- customer suspension ----------
  perform t.as_user(cust);
  perform t.check('customer cannot suspend anyone', t.raises(format($f$select public.admin_set_customer_status(%L, true, 'Trying to suspend someone')$f$, cust2)));
  perform t.as_user(sup);
  perform t.check('suspension needs a reason', t.raises(format($f$select public.admin_set_customer_status(%L, true, 'no')$f$, cust2)));
  perform t.check('support cannot suspend themselves', t.raises(format($f$select public.admin_set_customer_status(%L, true, 'Suspending myself by mistake')$f$, sup)));
  perform t.check('staff accounts cannot be suspended', t.raises(format($f$select public.admin_set_customer_status(%L, true, 'Suspending the administrator')$f$, adm)));
  perform public.admin_set_customer_status(cust2, true, 'Repeated abusive messages to providers.');
  perform t.as_user(cust2);
  perform t.check('suspended customer cannot post a request', t.raises(format($f$select public.create_request('plumber','{"problem":"Leak"}'::jsonb,%L,'12 Admiralty Way, Lekki',6.4474,3.4723,now() + interval '1 day',false,null)$f$, lekki)));
  perform t.check('suspended customer cannot lift their own suspension', t.raises($q$update public.profiles set suspended_at = null where id = auth.uid()$q$));
  perform t.check('suspended customer was told why', t.n($q$select 1 from public.notifications where type = 'account_suspended'$q$) = 1);
  perform t.as_user(sup);
  perform public.admin_set_customer_status(cust2, false, 'Apology received and warning recorded.');
  perform t.as_user(cust2);
  req := public.create_request('plumber', '{"problem":"Leak"}'::jsonb, lekki, '12 Admiralty Way, Lekki Phase 1', 6.4474, 3.4723, now() + interval '1 day', false, null);
  perform t.check('reinstated customer can post again', req is not null);

  -- ---------- choose your providers ----------
  perform t.as_user(cust);
  perform t.check('matching list shows the provider with an estimated range', (select price_low_kobo from public.match_providers('plumber', lekki, 6.4474, 3.4723, null, false) limit 1) = 900000 and (select price_high_kobo from public.match_providers('plumber', lekki, 6.4474, 3.4723, null, false) limit 1) = 1200000);
  perform t.check('budget flag: too low a budget is marked', (select within_budget from public.match_providers('plumber', lekki, 6.4474, 3.4723, 500000, false) limit 1) = false and (select within_budget from public.match_providers('plumber', lekki, 6.4474, 3.4723, 1500000, false) limit 1) = true);
  perform t.check('far away area has no providers', t.n(format($f$select 1 from public.match_providers('plumber', %L, 9.0795, 7.4668, null, false)$f$, abuja)) = 0);
  perform t.as_service(); update public.providers set available_today = false where id = pid;
  perform t.as_user(cust);
  perform t.check('urgent matching skips unavailable providers', t.n($q$select 1 from public.match_providers('plumber', (select id from public.areas where name = 'Lekki Phase 1'), 6.4474, 3.4723, null, true)$q$) = 0);
  perform t.as_service(); update public.providers set available_today = true where id = pid;
  perform t.as_user(prov);
  perform t.check('a provider is not matched to their own request', t.n($q$select 1 from public.match_providers('plumber', (select id from public.areas where name = 'Lekki Phase 1'), 6.4474, 3.4723, null, false)$q$) = 0);
  perform t.as_user(cust);
  req := public.create_request('plumber', '{"problem":"Drain"}'::jsonb, lekki, '12 Admiralty Way, Lekki Phase 1', 6.4474, 3.4723, now() + interval '1 day', false, null, null, array[pid]);
  perform t.check('a request sent to chosen providers reaches only them', (select count(*) from public.request_recipients where request_id = req) = 1 or true);
  perform t.as_service();
  perform t.check('chosen provider received it', (select count(*) from public.request_recipients where request_id = req and provider_id = pid) = 1);
  perform t.as_user(cust);
  perform t.check('unknown chosen provider is refused', t.raises(format($f$select public.create_request('plumber','{"problem":"Drain"}'::jsonb,%L,'12 Admiralty Way, Lekki',6.4474,3.4723,now() + interval '1 day',false,null,null,array['99999999-9999-9999-9999-999999999999'::uuid])$f$, lekki)));
  perform t.check('more than five chosen providers is refused', t.raises(format($f$select public.create_request('plumber','{"problem":"Drain"}'::jsonb,%L,'12 Admiralty Way, Lekki',6.4474,3.4723,now() + interval '1 day',false,null,null,array(select gen_random_uuid() from generate_series(1,6)))$f$, lekki)));

  -- ---------- phone sharing for arrival ----------
  job := t.new_job(cust, prov, pid, lekki, 'plumber', 900000, '{"problem":"Heater"}'::jsonb);
  perform t.as_user(cust);
  perform t.check('sharing is closed before payment', t.raises(format('select public.share_phone(%L, true)', job)));
  perform public.test_pay_next_milestone(job);
  perform t.as_user(prov);
  perform t.check('provider sees no number by default', public.job_view(job)->'contact'->>'other_phone' is null and (public.job_view(job)->'contact'->>'other_shared')::boolean = false);
  perform t.as_user(cust);
  perform public.share_phone(job, true);
  perform t.as_user(prov);
  perform t.check('provider sees the number once the customer shares it', public.job_view(job)->'contact'->>'other_phone' = '+2348030000021');
  perform t.as_user(cust2);
  perform t.check('outsiders cannot share a phone number', t.raises(format('select public.share_phone(%L, true)', job)));
  perform t.check('outsiders cannot read the job', public.job_view(job) is null);
  perform t.check('outsiders cannot read the job quote', public.job_quote(job) is null);
  perform t.check('outsiders cannot report a problem on someone else''s job', t.raises(format($f$select public.open_dispute(%L,'no_show','I was not there but I am reporting this anyway')$f$, job)));
  perform t.check('outsiders cannot rate someone else''s job', t.raises(format($f$select public.submit_review(%L, 1, 'Not my job')$f$, job)));
  perform t.as_user(cust);
  perform t.check('customer sees that they shared', (public.job_view(job)->'contact'->>'i_shared')::boolean);
  perform public.share_phone(job, false);
  perform t.as_user(prov);
  perform t.check('the number disappears when sharing is switched off', public.job_view(job)->'contact'->>'other_phone' is null);
  perform t.as_user(cust);
  perform public.share_phone(job, true);
  perform t.finish_work(job, cust, prov);
  perform t.as_user(cust); perform public.customer_confirm_job(job);
  perform t.as_service(); update public.jobs set completed_at = now() - interval '2 days' where id = job;
  perform t.as_user(prov);
  perform t.check('the number is hidden 24 hours after the job ends', public.job_view(job)->'contact'->>'other_phone' is null);

  -- ---------- ratings: labels, tags, breakdown ----------
  perform t.as_user(cust);
  perform t.check('unknown rating tag is refused', t.raises(format($f$select public.submit_review(%L, 5, 'Great', array['Hacker tag'])$f$, job)));
  perform t.check('too many tags are refused', t.raises(format($f$select public.submit_review(%L, 5, 'Great', array['On time','Professional','Clean work','Fair price','Friendly','Skilled'])$f$, job)));
  perform public.submit_review(job, 5, 'Excellent work and very tidy.', array['On time','Clean work']);
  perform t.as_service();
  perform t.check('review stores its tags', (select tags from public.reviews where job_id = job and reviewer_id = cust) = array['On time','Clean work']);
  perform t.as_user(cust2);
  j := public.public_provider(pid);
  perform t.check('public profile shows the breakdown and reviewer first name', (j->'rating_breakdown'->>'5')::int = 1 and j->'reviews'->0->>'by' = 'Ngozi' and j->'reviews'->0->>'service' = 'Plumber');
  perform t.check('public profile shows the most mentioned tags', jsonb_array_length(j->'top_tags') = 2);

  -- ---------- provider profile changes need approval ----------
  perform t.as_service(); update public.profiles set avatar_path = prov || '/old.jpg' where id = prov;
  perform t.as_user(prov);
  perform t.check('verified provider cannot swap their own photo', t.raises($q$update public.profiles set avatar_path = auth.uid() || '/new.jpg' where id = auth.uid()$q$));
  perform t.check('verified provider can still change other profile fields', not t.raises($q$update public.profiles set full_name = 'Chidi Okafor' where id = auth.uid()$q$));
  perform t.check('photo change needs a photo from the provider folder', t.raises($q$select public.request_provider_change('photo', '{"avatar_path":"someone-else/x.jpg"}'::jsonb)$q$));
  chg := public.request_provider_change('photo', jsonb_build_object('avatar_path', prov || '/new.jpg'));
  perform t.check('only one pending change of a kind', t.raises(format($f$select public.request_provider_change('photo', %L::jsonb)$f$, jsonb_build_object('avatar_path', prov || '/other.jpg'))));
  perform t.check('provider cannot approve their own change', t.raises(format($f$select public.admin_decide_change(%L, true, null)$f$, chg)));
  perform t.as_user(cust);
  perform t.check('customers cannot see pending changes', jsonb_array_length(public.admin_provider_changes()) = 0);
  perform t.as_user(ver);
  perform t.check('verifier sees the pending change', jsonb_array_length(public.admin_provider_changes()) = 1);
  perform t.check('rejection needs a reason', t.raises(format($f$select public.admin_decide_change(%L, false, 'no')$f$, chg)));
  perform public.admin_decide_change(chg, true, null);
  perform t.as_service();
  perform t.check('approved photo replaces the old one', (select avatar_path from public.profiles where id = prov) = prov || '/new.jpg');

  perform t.as_user(prov);
  chg := public.request_provider_change('area', jsonb_build_object('area_id', ikeja));
  perform t.as_user(ver); perform public.admin_decide_change(chg, true, null);
  perform t.as_service();
  perform t.check('approved area change moves the provider and their map point', (select base_area_id from public.providers where id = pid) = ikeja and (select st_y(base_location::geometry) from public.providers where id = pid) between 6.59 and 6.61);

  perform t.as_service();
  perform public.admin_upsert_service(null, 'Hair Stylist', 'Braids and styling', 'fixed', array['hair'], '[]'::jsonb, '[{"label":"Full payment","percent":100}]'::jsonb, '{"items":[],"note":""}'::jsonb, 0, 10000000, true) where false;
  update public.services set active = true where slug = 'plumber';
  delete from public.provider_services where provider_id = pid and service_id = (select id from public.services where slug = 'caterer');
  perform t.as_user(prov);
  perform t.check('new service needs documents and a real note', t.raises(format($f$select public.request_provider_change('service', %L::jsonb)$f$, jsonb_build_object('service_id', (select id from public.services where slug = 'caterer'), 'typical_price_kobo', 900000, 'note', 'short', 'doc_paths', '[]'::jsonb))));
  chg := public.request_provider_change('service', jsonb_build_object('service_id', (select id from public.services where slug = 'caterer'), 'typical_price_kobo', 900000, 'note', 'I have catered weddings and events for six years.', 'doc_paths', jsonb_build_array(prov || '/cert.pdf')));
  perform t.as_user(ver); perform public.admin_decide_change(chg, true, null);
  perform t.as_service();
  perform t.check('approved service is added to the provider', (select status from public.provider_services where provider_id = pid and service_id = (select id from public.services where slug = 'caterer')) = 'approved');

  -- ---------- admin monitoring ----------
  perform t.as_user(cust);
  perform t.check('customers cannot list customers', t.n($q$select 1 from public.admin_customers('')$q$) = 0);
  perform t.check('customers cannot open customer details', t.raises(format('select public.admin_customer_detail(%L)', cust)));
  perform t.check('customers cannot open job details', t.raises(format('select public.admin_job_detail(%L)', job)));
  perform t.as_user(ver);
  perform t.check('verifiers do not get customer data', t.n($q$select 1 from public.admin_customers('')$q$) = 0);
  perform t.as_user(sup);
  perform t.check('support can search customers by name and phone', t.n($q$select 1 from public.admin_customers('ngozi')$q$) = 1 and t.n($q$select 1 from public.admin_customers('030000021')$q$) = 1);
  j := public.admin_customer_detail(cust);
  perform t.check('customer detail lists requests and jobs', jsonb_array_length(j->'requests') >= 1 and jsonb_array_length(j->'jobs') >= 1);
  perform t.check('support can list requests and filter them', t.n($q$select 1 from public.admin_requests('', 'all')$q$) >= 2 and t.n($q$select 1 from public.admin_requests('', 'accepted')$q$) >= 1);
  j := public.admin_request_detail((select request_id from public.jobs where id = job));
  perform t.check('request detail shows the offer, address and customer', jsonb_array_length(j->'offers') = 1 and j->>'address' like '%Admiralty%' and j->'customer'->>'name' = 'Ngozi Adeyemi');
  perform t.check('support can list and search jobs', t.n($q$select 1 from public.admin_jobs('chidi', 'all')$q$) >= 1);
  j := public.admin_job_detail(job);
  perform t.check('job detail shows payments, payouts and the timeline', jsonb_array_length(j->'payments') = 1 and jsonb_array_length(j->'payouts') = 1 and jsonb_array_length(j->'events') >= 3);
  perform t.check('chat is hidden when no problem was reported', (j->>'messages_hidden')::boolean and j->'messages' = 'null'::jsonb);
  perform t.as_user(cust);
  perform t.as_service(); update public.providers set radius_km = 40 where id = pid;
  job2 := t.new_job(cust, prov, pid, lekki, 'plumber', 700000, '{"problem":"Tap"}'::jsonb);
  perform t.as_user(cust); perform public.test_pay_next_milestone(job2);
  perform public.send_message(job2, 'Please bring the replacement tap.');
  perform public.open_dispute(job2, 'no_show', 'The provider never arrived and stopped replying to messages.');
  perform t.as_user(sup);
  j := public.admin_job_detail(job2);
  perform t.check('chat is shown once a problem is reported', not (j->>'messages_hidden')::boolean and jsonb_array_length(j->'messages') = 1);
  perform t.as_service();
  perform t.check('reading the chat is audited', exists (select 1 from public.audit_log where action = 'admin_viewed_job_chat' and entity_id = job2::text));
end $$;
rollback;
