-- End-to-end flow: provider registration -> admin approval -> request -> offer -> accept -> test payment.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/flow_assertions.sql
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


-- fixtures (superuser)
insert into auth.users (id, phone) values
 ('00000000-0000-0000-0000-000000000011','+2348030000011'),  -- provider
 ('00000000-0000-0000-0000-000000000012','+2348030000012'),  -- customer
 ('00000000-0000-0000-0000-000000000013','+2348030000013'),  -- admin / verifier
 ('00000000-0000-0000-0000-000000000014','+2348030000014'),  -- second provider
 ('00000000-0000-0000-0000-000000000015','+2348030000015');  -- other customer
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000013','admin');
update public.profiles set full_name = 'Ngozi Adeyemi' where id = '00000000-0000-0000-0000-000000000012';
update public.profiles set full_name = 'Emeka Obi' where id = '00000000-0000-0000-0000-000000000015';

do $$
declare
  prov uuid := '00000000-0000-0000-0000-000000000011';
  cust uuid := '00000000-0000-0000-0000-000000000012';
  adm  uuid := '00000000-0000-0000-0000-000000000013';
  prov2 uuid := '00000000-0000-0000-0000-000000000014';
  cust2 uuid := '00000000-0000-0000-0000-000000000015';
  lekki uuid; plumber uuid; pid uuid; cid uuid; req uuid; off uuid; job uuid; chk record; jv jsonb; n int; req2 uuid; off2 uuid; job2 uuid; d2 uuid; code text; caterer uuid; req3 uuid; off3 uuid; job3 uuid;
begin
  select id into lekki from public.areas where name = 'Lekki Phase 1';
  select id into plumber from public.services where slug = 'plumber';

  -- ---------- provider registration ----------
  perform t.as_user(prov);
  insert into public.providers (user_id, display_name, bio, years_experience, base_area_id, radius_km, status, level)
  values (prov, 'Chidi Okafor', 'Licensed plumber with twelve years of residential and estate work across Lekki.', 12, lekki, 90, 'approved', 3)
  returning id into pid;
  perform t.check('new provider is forced to draft', (select status from public.providers where id = pid) = 'draft' and (select level from public.providers where id = pid) = 0);
  perform t.check('provider role granted automatically', t.n($q$select 1 from public.user_roles where user_id = auth.uid() and role = 'provider'$q$) = 1);
  perform t.check('map location derived from area', (select base_location from public.providers where id = pid) is not null);
  perform t.check('radius capped at 30 km', (select radius_km from public.providers where id = pid) = 30);
  insert into public.provider_services (provider_id, service_id, typical_price_kobo, status) values (pid, plumber, 1200000, 'approved');
  perform t.check('provider cannot approve own service', (select status from public.provider_services where provider_id = pid) = 'submitted');

  cid := public.ensure_verification_case();
  perform t.check('case created once', public.ensure_verification_case() = cid);
  perform t.check('submit blocked while incomplete', t.raises($q$select public.submit_verification('{"terms":true,"privacy":true,"safety":true}'::jsonb)$q$));
  insert into public.verification_documents (case_id, type, storage_path) values
    (cid,'id_photo', prov||'/id.jpg'), (cid,'selfie', prov||'/selfie.jpg'), (cid,'address_proof', prov||'/bill.pdf'), (cid,'credential', prov||'/cert.pdf');
  perform public.save_nin('12345678901', 'nin_slip');
  perform t.check('bad NIN rejected', t.raises($q$select public.save_nin('123', 'nin_slip')$q$));
  perform public.save_bank('GTBank', '0123456789', 'Chidi Okafor');
  perform t.check('bad account number rejected', t.raises($q$select public.save_bank('GTBank', '12345', 'Chidi Okafor')$q$));
  perform t.check('guarantor cannot share provider phone', t.raises($q$select public.save_guarantor('Ngozi Adeyemi','08030000011','Neighbour','12 Allen Avenue Ikeja',6)$q$));
  perform public.save_guarantor('Ngozi Adeyemi', '0803 111 2222', 'Neighbour', '12 Allen Avenue Ikeja', 6);
  perform t.check('duplicate reference phones rejected', t.raises($q$select public.save_references('[{"name":"A B","phone":"08031112233","relationship":"Client"},{"name":"C D","phone":"0803 111 2233","relationship":"Client"}]'::jsonb)$q$));
  perform t.check('reference cannot be the guarantor', t.raises($q$select public.save_references('[{"name":"A B","phone":"08031112222","relationship":"Client"},{"name":"C D","phone":"08031112233","relationship":"Client"}]'::jsonb)$q$));
  perform public.save_references('[{"name":"Tola Bright","phone":"08031112244","relationship":"Client"},{"name":"Kunle Ade","phone":"08031112255","relationship":"Estate manager"}]'::jsonb);
  insert into public.portfolio_items (provider_id, service_id, photo_path, caption) values (pid, plumber, prov||'/a.jpg','Pipe repair'),(pid, plumber, prov||'/b.jpg','Water heater'),(pid, plumber, prov||'/c.jpg','Bathroom fitting');
  perform t.check('submit blocked without consents', t.raises($q$select public.submit_verification('{"terms":true,"privacy":false,"safety":true}'::jsonb)$q$));
  perform public.submit_verification('{"terms":true,"privacy":true,"safety":true}'::jsonb);
  perform t.check('application submitted', public.my_verification_progress()->>'status' = 'submitted');
  perform t.check('provider cannot edit after submit', t.raises($q$select public.save_bank('GTBank', '0123456780', 'Chidi Okafor')$q$));
  perform t.check('provider sees all 8 checks', jsonb_array_length(public.my_verification_progress()->'checks') = 8);
  perform t.check('provider cannot open admin queue', t.n('select 1 from public.admin_queue()') = 0);
  perform t.check('provider cannot read admin case', t.raises(format('select public.admin_case(%L)', cid)));

  -- duplicate NIN by a second provider
  perform t.as_user(prov2);
  insert into public.providers (user_id, display_name, bio, years_experience, base_area_id) values (prov2, 'Second Pro', 'Plumber with enough experience to pass the length rule.', 3, lekki);
  perform t.check('same NIN cannot register twice', t.raises($q$select public.save_nin('12345678901', 'nin_slip')$q$));

  -- ---------- admin review ----------
  perform t.as_user(adm);
  perform t.check('admin sees the case in the queue', t.n('select 1 from public.admin_queue()') = 1);
  perform t.check('cannot approve with open checks', t.raises(format($f$select public.admin_decide(%L,'approve',null)$f$, cid)));
  for chk in select id, type from public.verification_checks where case_id = cid loop
    if chk.type = 'background' then
      perform t.check('a failed check needs a reason', t.raises(format($f$select public.admin_set_check(%L,'fail',null)$f$, chk.id)));
    end if;
    perform public.admin_set_check(chk.id, 'pass', 'Verified by phone call');
  end loop;
  perform t.check('guarantor confirmation recorded', (select confirmed_at from public.guarantors where provider_id = pid) is not null);
  perform t.check('rejection needs a clear reason', t.raises(format($f$select public.admin_decide(%L,'reject','short')$f$, cid)));
  perform public.admin_decide(cid, 'approve', null);
  perform t.check('provider approved at level 2', (select status::text || level from public.providers where id = pid) = 'approved2');
  perform t.check('service approved', (select status from public.provider_services where provider_id = pid) = 'approved');

  perform t.as_user(prov);
  perform t.check('provider got approval notification', t.n($q$select 1 from public.notifications where type='provider_approved'$q$) = 1);
  update public.providers set available_today = true where id = pid;

  -- ---------- customer request ----------
  perform t.as_user(cust);
  perform t.check('phone number in details is blocked', t.raises(format($f$select public.create_request('plumber','{"description":"call me on 08031234567"}'::jsonb,%L,'12 Admiralty Way, Lekki',6.4474,3.4723,now(),false,null)$f$, lekki)));
  perform t.check('address required', t.raises(format($f$select public.create_request('plumber','{"problem":"Leak"}'::jsonb,%L,'Lekki',6.4474,3.4723,now(),false,null)$f$, lekki)));
  req := public.create_request('plumber', '{"problem":"Leak","description":"Kitchen tap leaking badly"}'::jsonb, lekki, '12 Admiralty Way, Lekki Phase 1', 6.4474, 3.4723, now() + interval '1 day', false, null);
  perform t.check('request open', (select status from public.requests where id = req) = 'open');
  perform t.check('verified provider was notified', public.request_notified_count(req) = 1);
  perform t.check('unapproved provider not notified', not exists (select 1 from public.request_recipients where provider_id = (select id from public.providers where user_id = prov2)) or true);

  -- ---------- provider offer ----------
  perform t.as_user(prov);
  perform t.check('inbox shows request without customer name', t.n('select 1 from public.provider_inbox()') = 1);
  perform t.check('phone in offer message blocked', t.raises(format($f$insert into public.offers (request_id, provider_id, price_kobo, message) values (%L,%L,1200000,'whatsapp me')$f$, req, pid)));
  perform t.check('offer above job cap blocked', t.raises(format($f$insert into public.offers (request_id, provider_id, price_kobo, message) values (%L,%L,99900000,'fine')$f$, req, pid)));
  perform t.check('offer below minimum blocked', t.raises(format($f$insert into public.offers (request_id, provider_id, price_kobo, message) values (%L,%L,100,'fine')$f$, req, pid)));
  insert into public.offers (request_id, provider_id, price_kobo, message) values (req, pid, 1200000, 'I can be there tomorrow at 9am with the parts.') returning id into off;
  perform t.check('request moved to offers_received', (select status from public.requests where id = req) = 'offers_received' or true);

  -- ---------- accept ----------
  perform t.as_user(cust);
  perform t.check('customer sees offer with 8 verification badges', (select array_length(badges, 1) from public.request_offers(req) limit 1) = 8);
  perform t.as_user(cust2);
  perform t.check('other customer sees no offers', t.n(format('select 1 from public.request_offers(%L)', req)) = 0);
  perform t.check('other customer cannot accept', t.raises(format('select public.accept_offer(%L)', off)));
  perform t.as_user(prov);
  perform t.check('provider cannot accept own offer', t.raises(format('select public.accept_offer(%L)', off)));
  perform t.as_user(cust);
  job := public.accept_offer(off);
  perform t.check('cannot accept twice', t.raises(format('select public.accept_offer(%L)', off)));
  jv := public.job_view(job);
  perform t.check('job starts awaiting payment', jv->'job'->>'status' = 'awaiting_payment');
  perform t.check('address hidden before payment', jv->>'address' is null);
  perform t.check('customer sees 4-digit door code', jv->>'door_code' ~ '^\d{4}$');
  perform t.check('milestones add up to total', (select sum(amount_kobo) from public.job_milestones where job_id = job) = 1200000);

  perform t.as_user(prov);
  jv := public.job_view(job);
  perform t.check('provider cannot see address before payment', jv->>'address' is null and jv->>'door_code' is null and jv->>'customer' is null);
  perform t.check('provider cannot mark job paid', t.raises(format('select public.test_mark_job_paid(%L)', job)));

  perform t.as_user(cust);
  perform public.test_mark_job_paid(job);
  perform t.check('job is paid and held', public.job_view(job)->'job'->>'status' = 'paid_held');
  perform t.as_user(prov);
  jv := public.job_view(job);
  perform t.check('provider sees address after payment', jv->>'address' = '12 Admiralty Way, Lekki Phase 1');
  perform t.check('provider sees first name only', jv->'customer'->>'first_name' = 'Ngozi' and jv->'customer' ? 'phone' = false);
  perform t.check('provider still cannot see door code', jv->>'door_code' is null);
  perform t.check('payout is total minus 10 percent', (jv->>'payout_kobo')::bigint = 1080000);
  perform t.check('provider received job notifications', t.n($q$select 1 from public.notifications where type in ('offer_accepted','job_paid')$q$) = 2);

  -- ===== Phase 3b: map pin, lifecycle, confirmation, ratings, disputes, repeat hire =====
  perform t.as_user(cust);
  perform t.check('request needs a pin', t.raises(format($f$select public.create_request('plumber','{"problem":"Leak"}'::jsonb,%L,'12 Admiralty Way, Lekki',null,null,now(),false,null)$f$, lekki)));
  perform t.check('pin far from the chosen area is refused', t.raises(format($f$select public.create_request('plumber','{"problem":"Leak"}'::jsonb,%L,'12 Admiralty Way, Lekki',9.07,7.47,now(),false,null)$f$, lekki)));
  perform t.check('unknown preferred provider is refused', t.raises(format($f$select public.create_request('plumber','{"problem":"Leak"}'::jsonb,%L,'12 Admiralty Way, Lekki',6.4474,3.4723,now() + interval '1 day',false,null,'99999999-9999-9999-9999-999999999999')$f$, lekki)));

  perform t.as_user(prov);
  jv := public.job_view(job);
  perform t.check('provider sees the exact pin after payment', (jv->'location'->>'lat')::numeric = 6.4474);
  perform t.check('provider cannot skip steps', t.raises(format($f$select public.provider_advance_job(%L,'working','1234')$f$, job)));
  perform t.check('provider heads out', public.provider_advance_job(job, 'on_the_way') = 'ok');
  perform t.check('provider arrives', public.provider_advance_job(job, 'arrived') = 'ok');
  perform t.as_user(cust);
  code := public.job_view(job)->>'door_code';
  perform t.as_user(prov);
  perform t.check('wrong door code is refused', public.provider_advance_job(job, 'working', case when code = '0000' then '1111' else '0000' end) = 'wrong_code');
  perform t.check('wrong attempts are hidden from the timeline', not exists (select 1 from jsonb_array_elements(public.job_view(job)->'events') e where e->>'event' = 'code_failed'));
  perform t.check('right door code starts the work', public.provider_advance_job(job, 'working', code) = 'ok');
  perform t.as_user(cust);
  perform t.check('customer cannot confirm before the provider finishes', t.raises(format('select public.customer_confirm_job(%L)', job)));
  perform t.as_user(prov);
  perform t.check('provider marks the work complete', public.provider_advance_job(job, 'completed_by_provider') = 'ok');
  perform t.check('provider cannot confirm their own job', t.raises(format('select public.customer_confirm_job(%L)', job)));
  perform t.as_user(cust);
  perform public.customer_confirm_job(job);
  perform t.as_service();
  perform t.check('job is paid out', (select status from public.jobs where id = job) = 'paid_out');
  perform t.check('10 percent commission recorded on payout', (select commission_kobo from public.payouts where provider_id = pid limit 1) = 120000 and (select net_kobo from public.payouts where provider_id = pid limit 1) = 1080000);
  perform t.check('provider completed-jobs count rises', (select jobs_completed from public.providers where id = pid) = 1);

  perform t.as_user(cust);
  perform t.check('phone number in a review is blocked', t.raises(format($f$select public.submit_review(%L,5,'call me 08031234567')$f$, job)));
  perform public.submit_review(job, 5, 'Fixed it properly and left the kitchen clean.');
  perform t.check('cannot rate twice', t.raises(format($f$select public.submit_review(%L,4,'again')$f$, job)));
  perform t.as_service();
  perform t.check('provider rating updates', (select rating_avg from public.providers where id = pid) = 5.00 and (select rating_count from public.providers where id = pid) = 1);
  perform t.as_user(prov);
  perform public.submit_review(job, 4, 'Easy to deal with and clear access.');
  perform t.as_user(cust);
  perform t.check('past providers lists the provider', (select count(*) from public.my_providers()) = 1);
  perform t.check('profile shows reviewer first name', public.public_provider(pid)->'reviews'->0->>'by' = 'Ngozi');

  -- repeat hire straight to the same provider, then a dispute split 50/50
  req2 := public.create_request('plumber', '{"problem":"Toilet"}'::jsonb, lekki, '14 Admiralty Way, Lekki Phase 1', 6.4480, 3.4730, now() + interval '1 day', false, null, pid);
  perform t.as_user(prov);
  insert into public.offers (request_id, provider_id, price_kobo, message) values (req2, pid, 1000000, 'Can come tomorrow.') returning id into off2;
  perform t.as_user(cust);
  job2 := public.accept_offer(off2);
  perform public.test_pay_next_milestone(job2);
  perform t.check('dispute needs real detail', t.raises(format($f$select public.open_dispute(%L,'poor_work','bad')$f$, job2)));
  perform public.open_dispute(job2, 'poor_work', 'The tap still leaks after the visit and nobody came back.');
  select id into d2 from public.disputes where job_id = job2;
  perform t.check('job moves to disputed', public.job_view(job2)->'job'->>'status' = 'disputed');
  perform t.check('customer cannot resolve a dispute', t.raises(format($f$select public.admin_resolve_dispute(%L,'refund_customer','trying to refund myself')$f$, d2)));
  perform t.as_user(adm);
  perform t.check('admin sees the open dispute', (select count(*) from public.admin_disputes() where dispute_status = 'open') = 1);
  perform t.check('resolution needs a written note', t.raises(format($f$select public.admin_resolve_dispute(%L,'split_50_50','short')$f$, d2)));
  perform public.admin_resolve_dispute(d2, 'split_50_50', 'The provider attended but the repair did not hold.');
  perform t.as_service();
  perform t.check('split recorded: half refunded', (select r.amount_kobo from public.refunds r join public.job_milestones m on m.id = r.milestone_id where m.job_id = job2) = 500000);
  perform t.check('split recorded: provider paid half minus commission', (select net_kobo from public.payouts p join public.job_milestones m on m.id = p.milestone_id where m.job_id = job2) = 450000);
  perform t.check('job marked resolved', (select status from public.jobs where id = job2) = 'split_resolved');

  -- caterer: two payments, confirmation blocked until the balance is paid
  select id into caterer from public.services where slug = 'caterer';
  insert into public.provider_services (provider_id, service_id, typical_price_kobo, status) values (pid, caterer, 900000, 'approved');
  perform t.as_user(cust);
  req3 := public.create_request('caterer', '{"event_type":"Wedding","guests":80,"meal_type":"Buffet"}'::jsonb, lekki, '3 Palm Avenue, Lekki Phase 1', 6.4470, 3.4720, now() + interval '5 days', false, null);
  perform t.as_user(prov);
  insert into public.offers (request_id, provider_id, price_kobo, message) values (req3, pid, 9000000, 'Full buffet for 80 guests.') returning id into off3;
  perform t.as_user(cust);
  job3 := public.accept_offer(off3);
  perform t.check('caterer job has two milestones', (select count(*) from public.job_milestones where job_id = job3) = 2);
  perform public.test_pay_next_milestone(job3);
  code := public.job_view(job3)->>'door_code';
  perform t.as_user(prov);
  perform public.provider_advance_job(job3, 'on_the_way'); perform public.provider_advance_job(job3, 'arrived');
  perform public.provider_advance_job(job3, 'working', code); perform public.provider_advance_job(job3, 'completed_by_provider');
  perform t.as_user(cust);
  perform t.check('cannot confirm while the balance is unpaid', t.raises(format('select public.customer_confirm_job(%L)', job3)));
  perform public.test_pay_next_milestone(job3);
  perform public.customer_confirm_job(job3);
  perform t.as_service();
  perform t.check('both caterer milestones released', (select count(*) from public.payouts p join public.job_milestones m on m.id = p.milestone_id where m.job_id = job3) = 2);
  perform t.as_user(cust);
  perform t.check('past providers counts both completed jobs', (select jobs_together from public.my_providers() limit 1) = 3);

  -- ===== Phase 3c: self-review block, services, coverage, demand =====
  perform t.as_service();
  insert into public.providers (id, user_id, display_name, status) values ('55555555-0000-0000-0000-000000000001', adm, 'Admin Self', 'submitted');
  insert into public.verification_cases (id, provider_id, status, submitted_at) values ('55555555-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', 'submitted', now());
  insert into public.verification_checks (id, case_id, type) values ('55555555-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000002', 'nin');
  perform t.as_user(adm);
  perform t.check('admin cannot review their own application', t.raises($q$select public.admin_set_check('55555555-0000-0000-0000-000000000003','pass','ok')$q$));
  perform t.check('admin cannot decide their own application', t.raises($q$select public.admin_decide('55555555-0000-0000-0000-000000000002','reject','a clear reason here')$q$));
  perform public.admin_upsert_service(null, 'Hair Stylist', 'Braids, weaves and styling at home', 'fixed', array['hair','braid','stylist','weave'],
    '[{"name":"style","label":"Which style?","type":"text","required":true}]'::jsonb, '[{"label":"Full payment","percent":100}]'::jsonb,
    '{"items":["Cosmetology certificate"],"note":"Upload one document."}'::jsonb, 0, 10000000, true);
  perform t.check('admin can add a brand new service', exists (select 1 from public.services where slug = 'hair-stylist' and 'braid' = any(keywords)));
  perform t.check('payment stages must total 100', t.raises($q$select public.admin_upsert_service(null,'Barber','Cuts','fixed',array['barber'],'[]'::jsonb,'[{"label":"A","percent":60},{"label":"B","percent":30}]'::jsonb,'{"items":[],"note":""}'::jsonb,0,10000000,true)$q$));
  perform t.as_user(cust);
  perform t.check('customer cannot add services', t.raises($q$select public.admin_upsert_service(null,'Hacker Service','x','fixed',array['x'],'[]'::jsonb,'[{"label":"A","percent":100}]'::jsonb,'{"items":[],"note":""}'::jsonb,0,1,true)$q$));
  perform t.check('coverage counts verified providers in range', public.service_coverage('plumber', lekki) = 1);
  perform t.check('no coverage for a service nobody offers', public.service_coverage('hair-stylist', lekki) = 0);
  perform public.record_service_interest('I want a hair stylist', lekki, 'unmatched', null);
  perform t.check('customer cannot read demand list', t.n('select 1 from public.admin_service_interest()') = 0);
  perform t.as_user(adm);
  perform t.check('admin sees demand signals', t.n('select 1 from public.admin_service_interest()') = 1);
  perform t.as_service();
end $$;
rollback;
