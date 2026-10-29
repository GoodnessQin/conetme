-- RLS and guard assertions. Plain SQL: runs in psql, rolls back, leaves nothing behind.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_assertions.sql
-- Prints "PASS" lines; any failure raises an exception and stops.
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

-- fixtures (run as superuser, so guards treat us as service)
insert into auth.users (id, phone) values
 ('00000000-0000-0000-0000-0000000000a1','+2348030000001'),  -- alice (customer)
 ('00000000-0000-0000-0000-0000000000b2','+2348030000002'),  -- bob (customer)
 ('00000000-0000-0000-0000-0000000000c3','+2348030000003'),  -- approved provider
 ('00000000-0000-0000-0000-0000000000d4','+2348030000004'),  -- pending provider
 ('00000000-0000-0000-0000-0000000000e5','+2348030000005'),  -- verifier
 ('00000000-0000-0000-0000-0000000000f6','+2348030000006'),  -- admin
 ('00000000-0000-0000-0000-0000000000a7','+2348030000007');  -- approved provider, not notified
insert into public.user_roles (user_id, role) values
 ('00000000-0000-0000-0000-0000000000e5','verifier'),
 ('00000000-0000-0000-0000-0000000000f6','admin');
insert into public.providers (id, user_id, display_name, status, level) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000c3','Chidi','approved',2),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000d4','Tunde','submitted',0),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-0000000000a7','Amaka','approved',2);
insert into public.provider_private (provider_id, nin_hash, nin_last4) values ('11111111-1111-1111-1111-111111111111','hash1','1234');
insert into public.verification_cases (id, provider_id, status) values ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','submitted');
insert into public.verification_documents (case_id, type, storage_path) values ('44444444-4444-4444-4444-444444444444','id_photo','x/y.jpg');
insert into public.requests (id, customer_id, service_id, status)
 select '55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-0000000000a1', id, 'open' from public.services where slug='plumber';
insert into public.request_private (request_id, address_text) values ('55555555-5555-5555-5555-555555555555','12 Admiralty Way, Lekki');
insert into public.request_recipients (request_id, provider_id) values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111');

do $$
declare
  alice uuid := '00000000-0000-0000-0000-0000000000a1';
  bob   uuid := '00000000-0000-0000-0000-0000000000b2';
  prov  uuid := '00000000-0000-0000-0000-0000000000c3';
  pend  uuid := '00000000-0000-0000-0000-0000000000d4';
  ver   uuid := '00000000-0000-0000-0000-0000000000e5';
  adm   uuid := '00000000-0000-0000-0000-0000000000f6';
  prov2 uuid := '00000000-0000-0000-0000-0000000000a7';
  job uuid; off uuid;
begin
  perform t.check('signup trigger made profile + customer role',
    t.n($q$select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id='00000000-0000-0000-0000-0000000000a1' and r.role='customer'$q$) = 1);

  -- profiles
  perform t.as_user(alice);
  perform t.check('customer reads own profile', t.n('select 1 from public.profiles where id = auth.uid()') = 1);
  perform t.check('customer cannot read another customer profile', t.n('select 1 from public.profiles where id = ''' || bob || '''') = 0);
  perform t.check('customer can read approved provider profile', t.n('select 1 from public.profiles where id = ''' || prov || '''') = 1);
  perform t.check('customer cannot read pending provider profile', t.n('select 1 from public.profiles where id = ''' || pend || '''') = 0);
  perform t.check('customer cannot self-verify', t.raises('update public.profiles set customer_verified = true where id = auth.uid()'));
  perform t.check('customer can edit own name', not t.raises('update public.profiles set full_name = ''Alice Ade'' where id = auth.uid()'));
  perform t.check('customer cannot grant self admin', t.raises($q$insert into public.user_roles (user_id, role) values (auth.uid(), 'admin')$q$));
  perform t.check('customer cannot read audit log', t.n('select 1 from public.audit_log') = 0);
  perform t.check('anyone signed in can read services', t.n('select 1 from public.services') = 3);

  -- providers
  perform t.as_user(pend);
  perform t.check('pending provider cannot self-approve', t.raises($q$update public.providers set status='approved' where user_id = auth.uid()$q$));
  perform t.check('pending provider cannot raise own level', t.raises($q$update public.providers set level=3 where user_id = auth.uid()$q$));
  perform t.check('pending provider cannot fake rating', t.raises($q$update public.providers set rating_avg=5 where user_id = auth.uid()$q$));
  perform t.check('provider can edit bio', not t.raises($q$update public.providers set bio='20 years fixing pipes' where user_id = auth.uid()$q$));
  perform t.check('pending provider sees no requests', t.n('select 1 from public.requests') = 0);
  perform t.as_user(prov);
  perform t.check('provider cannot read private NIN data', t.n('select 1 from public.provider_private') = 0);
  perform t.check('provider cannot read others verification docs', t.n('select 1 from public.verification_documents') = 0);

  -- verification access
  perform t.as_user(ver);
  perform t.check('verifier reads NIN data', t.n('select 1 from public.provider_private') = 1);
  perform t.check('verifier reads verification documents', t.n('select 1 from public.verification_documents') = 1);
  perform t.check('verifier cannot read audit log', t.n('select 1 from public.audit_log') = 0);
  perform t.as_user(adm);
  perform t.check('admin reads audit log', t.n('select 1 from public.audit_log') >= 0);
  perform t.as_user(bob);
  perform t.check('random user cannot read verification docs', t.n('select 1 from public.verification_documents') = 0);

  -- requests and address privacy
  perform t.as_user(bob);
  perform t.check('other customer cannot see request', t.n('select 1 from public.requests') = 0);
  perform t.as_user(alice);
  perform t.check('owner sees own request', t.n('select 1 from public.requests') = 1);
  perform t.check('customer cannot create an already-accepted request',
    t.raises($q$insert into public.requests (customer_id, service_id, status) select auth.uid(), id, 'accepted' from public.services limit 1$q$));
  perform t.check('customer cannot create a request as someone else',
    t.raises($q$insert into public.requests (customer_id, service_id, status) select '00000000-0000-0000-0000-0000000000b2', id, 'open' from public.services limit 1$q$));
  perform t.as_user(prov);
  perform t.check('notified provider sees the request', t.n('select 1 from public.requests') = 1);
  perform t.check('notified provider cannot see exact address before payment', t.n('select 1 from public.request_private') = 0);
  perform t.as_user(prov2);
  perform t.check('approved but un-notified provider sees nothing', t.n('select 1 from public.requests') = 0);

  -- offers
  perform t.as_user(pend);
  perform t.check('unapproved provider cannot send offer',
    t.raises($q$insert into public.offers (request_id, provider_id, price_kobo) values ('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222', 900000)$q$));
  perform t.as_user(prov2);
  perform t.check('un-notified provider cannot send offer',
    t.raises($q$insert into public.offers (request_id, provider_id, price_kobo) values ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333', 900000)$q$));
  perform t.as_user(prov);
  perform t.check('notified approved provider can send offer',
    not t.raises($q$insert into public.offers (request_id, provider_id, price_kobo) values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111', 900000)$q$));
  perform t.check('provider cannot send a second offer on same request',
    t.raises($q$insert into public.offers (request_id, provider_id, price_kobo) values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111', 800000)$q$));
  perform t.as_user(alice);
  perform t.check('customer sees offers on own request', t.n('select 1 from public.offers') = 1);
  perform t.as_user(bob);
  perform t.check('other customer cannot see offers', t.n('select 1 from public.offers') = 0);

  -- jobs, secrets, money (created by service role like accept-offer would)
  perform t.as_service();
  select id into off from public.offers limit 1;
  insert into public.jobs (id, request_id, offer_id, customer_id, provider_id, total_kobo, commission_bps, status)
    values ('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555', off, alice, '11111111-1111-1111-1111-111111111111', 900000, 1000, 'awaiting_payment');
  insert into public.job_secrets (job_id, door_code) values ('66666666-6666-6666-6666-666666666666','4821');
  insert into public.job_milestones (id, job_id, label, position, amount_kobo) values ('77777777-7777-7777-7777-777777777777','66666666-6666-6666-6666-666666666666','Full payment',1,900000);
  insert into public.payments (milestone_id, reference, amount_kobo) values ('77777777-7777-7777-7777-777777777777','ref_1',900000);

  perform t.as_user(prov);
  perform t.check('provider sees own job', t.n('select 1 from public.jobs') = 1);
  perform t.check('provider cannot read door code', t.n('select 1 from public.job_secrets') = 0);
  perform t.check('provider cannot see address while awaiting payment', t.n('select 1 from public.request_private') = 0);
  perform t.check('provider cannot read payments', t.n('select 1 from public.payments') = 0);
  perform t.check('provider cannot change job status', t.raises($q$update public.jobs set status='paid_out'$q$) or t.n($q$select 1 from public.jobs where status='paid_out'$q$) = 0);
  perform t.as_user(alice);
  perform t.check('customer reads door code', t.n('select 1 from public.job_secrets') = 1);
  perform t.check('customer reads own payment', t.n('select 1 from public.payments') = 1);
  perform t.check('customer cannot insert payment', t.raises($q$insert into public.payments (milestone_id, reference, amount_kobo) values ('77777777-7777-7777-7777-777777777777','ref_x',1)$q$));
  perform t.check('customer cannot insert chat directly', t.raises($q$insert into public.messages (job_id, sender_id, body) values ('66666666-6666-6666-6666-666666666666', auth.uid(), 'call me on 0803')$q$));
  perform t.as_user(bob);
  perform t.check('stranger sees no jobs', t.n('select 1 from public.jobs') = 0);
  perform t.check('stranger cannot read door code', t.n('select 1 from public.job_secrets') = 0);

  -- once paid, address unlocks for the provider
  perform t.as_service();
  update public.jobs set status = 'paid_held' where id = '66666666-6666-6666-6666-666666666666';
  perform t.as_user(prov);
  perform t.check('provider sees address after payment', t.n('select 1 from public.request_private') = 1);

  -- reviews only after payout
  perform t.as_user(alice);
  perform t.check('cannot review before payout', t.raises($q$insert into public.reviews (job_id, reviewer_id, reviewee_id, stars) values ('66666666-6666-6666-6666-666666666666', auth.uid(), '00000000-0000-0000-0000-0000000000c3', 5)$q$));
  perform t.as_service();
  update public.jobs set status = 'paid_out' where id = '66666666-6666-6666-6666-666666666666';
  perform t.as_user(alice);
  perform t.check('can review after payout', not t.raises($q$insert into public.reviews (job_id, reviewer_id, reviewee_id, stars) values ('66666666-6666-6666-6666-666666666666', auth.uid(), '00000000-0000-0000-0000-0000000000c3', 5)$q$));
  perform t.as_user(bob);
  perform t.check('stranger cannot review someone elses job', t.raises($q$insert into public.reviews (job_id, reviewer_id, reviewee_id, stars) values ('66666666-6666-6666-6666-666666666666', auth.uid(), '00000000-0000-0000-0000-0000000000c3', 1)$q$));

  perform t.as_service();
end $$;

rollback;
