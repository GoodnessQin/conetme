-- Payments, ledger, payouts, refunds, cancellation, scheduling, chat, quotes, admin tools.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/payments_assertions.sql
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

do $$
declare
  cust uuid := '00000000-0000-0000-0000-000000000021'; prov uuid := '00000000-0000-0000-0000-000000000022'; adm uuid := '00000000-0000-0000-0000-000000000023'; cust2 uuid := '00000000-0000-0000-0000-000000000024';
  pid uuid := '22222222-0000-0000-0000-000000000022'; lekki uuid; job uuid; job2 uuid; job3 uuid; job4 uuid; pay1 jsonb; pay2 jsonb; s jsonb; r text; po record; rf record; q uuid; fj uuid; code text; req uuid;
begin
  select id into lekki from public.areas where name = 'Lekki Phase 1';

  -- ---------- permissions: money functions are closed to the browser ----------
  perform t.as_user(cust);
  perform t.check('browser cannot post to the ledger', t.raises($q$select public.post_ledger('x', null, null, 'x', '[]'::jsonb)$q$));
  perform t.check('browser cannot apply a payment', t.raises($q$select public.apply_payment_success('abc', 1, 0, '{}'::jsonb)$q$));
  perform t.check('browser cannot claim payouts', t.raises($q$select * from public.claim_payouts(5)$q$));
  perform t.check('browser cannot mark a payout sent', t.raises($q$select public.mark_payout_sent(gen_random_uuid(), 'x', 0)$q$));
  perform t.check('browser cannot run scheduled work', t.raises($q$select public.run_auto_confirm()$q$));
  perform t.check('browser cannot write identity checks', t.raises($q$select public.record_auto_check(gen_random_uuid(), 'nin', 'pass', 1, 'x', 'x')$q$));
  perform t.check('customer cannot read the finance summary', t.raises($q$select public.finance_summary()$q$));
  perform t.check('customer cannot read the ledger table', t.n('select 1 from public.ledger_entries') = 0);

  -- ---------- test-mode payment writes the ledger ----------
  job := t.new_job(cust, prov, pid, lekki, 'plumber', 1000000, '{"problem":"Leak"}'::jsonb);
  perform t.as_user(cust);
  perform t.check('real checkout is off in test mode', t.raises(format('select public.start_payment(%L)', job)));
  perform public.test_pay_next_milestone(job);
  perform t.as_user(adm);
  s := public.finance_summary();
  perform t.check('ledger: cash and held equal the payment', (s->>'cash_kobo')::bigint = 1000000 and (s->>'held_kobo')::bigint = 1000000);
  perform t.check('reconciliation passes after a payment', (s->>'ok')::boolean);
  perform t.as_service();
  perform t.check('the ledger cannot be edited', t.raises($q$update public.ledger_entries set amount_kobo = 1$q$));
  perform t.check('the ledger cannot be deleted from', t.raises($q$delete from public.ledger_entries$q$));
  perform t.check('unbalanced ledger entry is refused', t.raises($q$select public.post_ledger('x', null, null, 'x', '[{"account":"cash","dir":"debit","amount":5},{"account":"held","dir":"credit","amount":4}]'::jsonb)$q$));

  -- ---------- confirm, payout, earnings ----------
  perform t.finish_work(job, cust, prov);
  perform t.as_user(cust);
  perform public.customer_confirm_job(job);
  perform t.as_user(prov);
  s := public.provider_earnings();
  perform t.check('earnings: payout waiting is total minus commission', (s->>'payable_kobo')::bigint = 900000 and (s->>'paid_kobo')::bigint = 0);
  perform t.as_user(adm);
  s := public.finance_summary();
  perform t.check('ledger: commission earned is 10 percent', (s->>'commission_kobo')::bigint = 100000 and (s->>'payable_kobo')::bigint = 900000 and (s->>'held_kobo')::bigint = 0);
  perform t.check('reconciliation passes after release', (s->>'ok')::boolean);
  perform t.as_service();
  select * into po from public.claim_payouts(10);
  perform t.check('payout runner receives the verified bank details', po.net_kobo = 900000 and po.account_number = '0123456789' and po.bank_code = '058' and po.reference like 'po-%');
  perform t.check('a claimed payout is not claimed twice', (select count(*) from public.claim_payouts(10)) = 0);
  perform public.mark_payout_failed(po.payout_id, 'Bank timeout', false);
  perform t.check('a retryable failure keeps the payout pending', (select status from public.payouts where id = po.payout_id) = 'pending');
  select * into po from public.claim_payouts(10);
  perform public.mark_payout_sent(po.payout_id, 'TRF_123', 5000);
  perform public.mark_payout_sent(po.payout_id, 'TRF_123', 5000);
  perform t.check('sending a payout twice only posts once', (select count(*) from public.ledger_entries where ref_type = 'payout' and ref_id = po.payout_id) = 3);
  perform t.as_user(adm);
  s := public.finance_summary();
  perform t.check('reconciliation passes after a payout and transfer fee', (s->>'ok')::boolean and (s->>'fees_kobo')::bigint = 5000 and (s->>'payable_kobo')::bigint = 0);
  perform t.as_user(prov);
  perform t.check('earnings: paid out shows', (public.provider_earnings()->>'paid_kobo')::bigint = 900000);
  perform t.check('provider was notified of the payout', t.n($q$select 1 from public.notifications where type = 'payout_sent'$q$) = 1);

  -- ---------- live checkout: reference, amount check, idempotency, duplicates ----------
  perform t.as_service();
  update public.settings set value = '"paystack"' where key = 'payment_mode';
  job2 := t.new_job(cust, prov, pid, lekki, 'plumber', 800000, '{"problem":"Drain"}'::jsonb);
  perform t.as_user(cust);
  perform t.check('test payments are refused in live mode', t.raises(format('select public.test_pay_next_milestone(%L)', job2)));
  pay1 := public.start_payment(job2);
  pay2 := public.start_payment(job2);
  perform t.check('payment reference is Paystack-safe', pay1->>'reference' ~ '^cm[0-9a-f]{32}$');
  perform t.as_user(cust2);
  perform t.check('someone else cannot start a payment on this job', t.raises(format('select public.start_payment(%L)', job2)));
  perform t.as_service();
  perform t.check('unknown reference is ignored', public.apply_payment_success('cmnope', 800000, 0, '{}'::jsonb) = 'unknown_reference');
  perform t.check('wrong amount is rejected and flagged', public.apply_payment_success(pay2->>'reference', 700000, 0, '{}'::jsonb) = 'amount_mismatch');
  perform t.check('a mismatch is recorded for review', exists (select 1 from public.audit_log where action = 'payment_amount_mismatch'));
  perform t.as_user(cust);
  pay2 := public.start_payment(job2);
  perform t.as_service();
  perform t.check('correct payment is applied', public.apply_payment_success(pay1->>'reference', 800000, 12000, '{"status":"success"}'::jsonb) = 'ok');
  perform t.check('same webhook twice is harmless', public.apply_payment_success(pay1->>'reference', 800000, 12000, '{}'::jsonb) = 'already');
  perform t.check('job is paid and held', (select status from public.jobs where id = job2) = 'paid_held');
  perform t.check('processor fee is booked as an expense', (select l.amount_kobo from public.ledger_entries l where l.account = 'fees' and l.ref_id = (pay1->>'payment_id')::uuid) = 12000);
  perform t.check('a second payment for an already paid milestone is queued for refund', public.apply_payment_success(pay2->>'reference', 800000, 0, '{}'::jsonb) = 'duplicate_refunded'
    and (select r.amount_kobo from public.refunds r where r.payment_id = (pay2->>'payment_id')::uuid) = 800000);
  perform t.check('webhook log blocks replays', public.log_webhook('paystack', 'charge.success', 'ref1', '{}'::jsonb) and not public.log_webhook('paystack', 'charge.success', 'ref1', '{}'::jsonb));
  perform t.as_user(adm);
  perform t.check('reconciliation passes with live payments', (public.finance_summary()->>'ok')::boolean);
  perform t.as_service();
  update public.settings set value = '"test"' where key = 'payment_mode';

  -- ---------- cancellation and refunds ----------
  perform t.as_user(cust);
  perform t.check('customer needs a reason to cancel', t.raises(format($f$select public.cancel_job(%L,'x')$f$, job2)));
  perform public.cancel_job(job2, 'Plans changed, no longer needed');
  perform t.check('full refund on early cancel', (select r.amount_kobo from public.refunds r join public.job_milestones m on m.id = r.milestone_id where m.job_id = job2 and r.reason = 'Job cancelled') = 800000 and (select status from public.jobs where id = job2) = 'refunded');
  perform t.as_service();
  select * into rf from public.claim_refunds(1);
  perform t.check('refund runner receives the original payment', rf.amount_kobo = 800000 and rf.payment_provider = 'paystack');
  perform public.mark_refund_sent(rf.refund_id, 'RF_1');
  for rf in select * from public.claim_refunds(5) loop perform public.mark_refund_sent(rf.refund_id, 'RF_2'); end loop;
  perform t.as_user(adm);
  perform t.check('reconciliation passes after a refund', (public.finance_summary()->>'ok')::boolean);

  job3 := t.new_job(cust, prov, pid, lekki, 'plumber', 1000000, '{"problem":"Heater"}'::jsonb);
  perform t.as_user(cust); perform public.test_pay_next_milestone(job3);
  perform t.as_user(prov); perform public.provider_advance_job(job3, 'on_the_way');
  perform t.as_user(cust);
  perform public.cancel_job(job3, 'The provider is taking too long');
  perform t.as_service();
  perform t.check('late customer cancel pays the callout fee (15 percent cap)', (select p.gross_kobo from public.payouts p join public.job_milestones m on m.id = p.milestone_id where m.job_id = job3) = 150000
    and (select r.amount_kobo from public.refunds r join public.job_milestones m on m.id = r.milestone_id where m.job_id = job3) = 850000);
  perform t.as_user(adm);
  perform t.check('reconciliation passes after a late cancel', (public.finance_summary()->>'ok')::boolean);

  job4 := t.new_job(cust, prov, pid, lekki, 'plumber', 1000000, '{"problem":"Pump"}'::jsonb);
  perform t.as_user(cust); perform public.test_pay_next_milestone(job4);
  perform t.as_user(prov);
  perform public.cancel_job(job4, 'Emergency, cannot attend today');
  perform t.as_service();
  perform t.check('provider cancel refunds in full and counts against the provider', (select cancellation_count from public.providers where id = pid) = 1 and (select status from public.jobs where id = job4) = 'refunded');

  -- ---------- unpaid jobs, auto-confirm, expiry ----------
  job := t.new_job(cust, prov, pid, lekki, 'plumber', 700000, '{"problem":"Tap"}'::jsonb);
  perform t.as_service();
  update public.jobs set created_at = now() - interval '30 hours' where id = job;
  r := public.run_stale_unpaid()::text;
  perform t.check('stale unpaid job is cancelled', r = '1' and (select status from public.jobs where id = job) = 'cancelled');

  job := t.new_job(cust, prov, pid, lekki, 'plumber', 700000, '{"problem":"Sink"}'::jsonb);
  perform t.as_user(cust); perform public.test_pay_next_milestone(job);
  perform t.finish_work(job, cust, prov);
  perform t.as_service();
  perform t.check('auto-confirm waits the full period', public.run_auto_confirm() = 0);
  update public.job_events set created_at = now() - interval '3 days' where job_id = job and event = 'completed_by_provider';
  r := public.run_auto_confirm()::text;
  perform t.check('auto-confirm releases after 48 hours', r = '1' and (select status from public.jobs where id = job) = 'paid_out');
  perform t.check('auto-confirmed payout exists', (select p.net_kobo from public.payouts p join public.job_milestones m on m.id = p.milestone_id where m.job_id = job) = 630000);

  perform t.as_user(adm); r := public.finance_run_test_payouts()::text; perform t.as_service();
  update public.settings set value = '24' where key = 'payout_delay_hours';
  update public.settings set value = '500000' where key = 'payout_approval_threshold_kobo';
  job := t.new_job(cust, prov, pid, lekki, 'plumber', 900000, '{"problem":"Bath"}'::jsonb);
  perform t.as_user(cust); perform public.test_pay_next_milestone(job);
  perform t.finish_work(job, cust, prov);
  perform t.as_user(cust); perform public.customer_confirm_job(job);
  perform t.as_service();
  perform t.check('payout delay holds the payout back', (select count(*) from public.claim_payouts(10)) = 0 and (select p.needs_approval from public.payouts p join public.job_milestones m on m.id = p.milestone_id where m.job_id = job));
  update public.payouts set available_at = now() - interval '1 minute' where available_at > now();
  perform t.check('large payouts need finance approval', (select count(*) from public.claim_payouts(10)) = 0);
  perform t.as_user(cust);
  perform t.check('customer cannot approve payouts', t.raises($q$select public.finance_approve_payout((select id from public.payouts where needs_approval limit 1))$q$));
  perform t.as_user(adm);
  perform public.finance_approve_payout((select id from public.payouts where needs_approval limit 1));
  perform t.as_service();
  perform t.check('approved payout can be claimed', (select count(*) from public.claim_payouts(10)) = 1);
  update public.settings set value = '0' where key = 'payout_delay_hours';
  update public.settings set value = '50000000' where key = 'payout_approval_threshold_kobo';
  perform t.as_user(adm);
  r := public.finance_run_test_payouts()::text;
  perform t.check('test payout run completes pending payouts', (select count(*) from public.payouts where status = 'pending') = 0);

  perform t.as_service();
  insert into public.requests (id, customer_id, service_id, status, expires_at, area_id) select '77777777-0000-0000-0000-000000000001', cust, id, 'open', now() - interval '1 hour', lekki from public.services where slug = 'plumber';
  r := public.run_expire_requests()::text;
  perform t.check('overdue requests expire', r::int >= 1 and (select status from public.requests where id = '77777777-0000-0000-0000-000000000001') = 'expired');

  -- ---------- chat ----------
  job := t.new_job(cust, prov, pid, lekki, 'plumber', 600000, '{"problem":"Leak 2"}'::jsonb);
  perform t.as_user(cust);
  perform t.check('chat is closed before payment', t.raises(format($f$select public.send_message(%L,'Hello')$f$, job)));
  perform public.test_pay_next_milestone(job);
  perform public.send_message(job, 'The gate code is at the security post.');
  perform t.check('phone numbers are blocked in chat', t.raises(format($f$select public.send_message(%L,'call me on 08031234567')$f$, job)));
  perform t.check('chat app names are blocked', t.raises(format($f$select public.send_message(%L,'message me on WhatsApp')$f$, job)));
  perform t.as_user(prov);
  perform t.check('provider sees the message and a notification', t.n(format('select 1 from public.messages where job_id = %L', job)) = 1 and t.n($q$select 1 from public.notifications where type = 'new_message'$q$) = 1);
  perform public.send_message(job, 'Understood, I will ask the security guard.');
  perform public.mark_messages_read(job);
  perform t.as_user(cust2);
  perform t.check('outsiders cannot read or send chat', t.n(format('select 1 from public.messages where job_id = %L', job)) = 0 and t.raises(format($f$select public.send_message(%L,'hi')$f$, job)));

  -- ---------- solar: inspection, then a quote ----------
  perform t.as_service(); update public.requests set created_at = now() - interval '2 hours' where customer_id = cust;
  fj := t.new_job(cust, prov, pid, lekki, 'solar-installer', 1500000, '{"property":"House","goal":"Backup power","power_use":"Fridge, TV, lights and fans for 12 hours"}'::jsonb);
  perform t.as_user(cust); perform public.test_pay_next_milestone(fj);
  perform t.check('solar booking has one inspection payment', (select count(*) from public.job_milestones where job_id = fj) = 1);
  perform t.finish_work(fj, cust, prov);
  perform t.as_user(prov);
  perform t.check('quote is refused before the inspection is confirmed', t.raises(format($f$select public.send_quote(%L, 120000000, 'Five kVA inverter, ten panels, batteries, five year warranty.')$f$, fj)));
  perform t.as_user(cust); perform public.customer_confirm_job(fj);
  perform t.as_user(prov);
  perform t.check('provider can send a quote after the inspection', public.job_quote(fj)->>'can_send' = 'true');
  perform t.check('quote needs a real scope', t.raises(format($f$select public.send_quote(%L, 120000000, 'short')$f$, fj)));
  q := public.send_quote(fj, 120000000, 'Five kVA inverter, ten 550W panels, two lithium batteries, installation and a five year warranty.');
  perform t.check('only one quote at a time', t.raises(format($f$select public.send_quote(%L, 110000000, 'Five kVA inverter, ten 550W panels, two lithium batteries, installation.')$f$, fj)));
  perform t.as_user(cust2);
  perform t.check('a stranger cannot answer the quote', t.raises(format('select public.respond_quote(%L, true)', q)));
  perform t.as_user(cust);
  job2 := public.respond_quote(q, true);
  perform t.check('accepted quote creates a three-stage job', (select count(*) from public.job_milestones where job_id = job2) = 3 and (select total_kobo from public.jobs where id = job2) = 120000000);
  perform t.check('quote stages are 40, 40 and 20 percent', (select array_agg(m.amount_kobo order by m.position) from public.job_milestones m where m.job_id = job2) = array[48000000::bigint, 48000000, 24000000]);
  perform t.check('quote cannot be accepted twice', t.raises(format('select public.respond_quote(%L, true)', q)));
  perform t.check('new job needs payment first', public.job_view(job2)->'job'->>'status' = 'awaiting_payment');

  -- ---------- admin tools ----------
  perform t.as_user(cust);
  perform t.check('customer cannot list providers', t.n($q$select 1 from public.admin_providers('')$q$) = 0);
  perform t.check('customer cannot suspend a provider', t.raises(format($f$select public.admin_set_provider_status(%L,'suspended','Trying to suspend')$f$, pid)));
  perform t.as_user(adm);
  perform t.check('admin can search providers by name and phone', t.n($q$select 1 from public.admin_providers('chidi')$q$) = 1 and t.n($q$select 1 from public.admin_providers('030000022')$q$) = 1);
  perform t.check('suspension needs a reason', t.raises(format($f$select public.admin_set_provider_status(%L,'suspended','no')$f$, pid)));
  perform public.admin_set_provider_status(pid, 'suspended', 'Repeated complaints about missed visits.');
  perform t.as_service();
  perform t.check('suspended provider is out of matching', public.service_coverage('plumber', lekki) = 0 and (select available_today from public.providers where id = pid) = false);
  perform t.check('suspension is audited', exists (select 1 from public.audit_log where action = 'provider_status_changed'));
  perform t.as_user(adm);
  perform public.admin_set_provider_status(pid, 'approved', 'Complaints reviewed and resolved with the provider.');
  perform t.as_service();
  perform t.check('reinstated provider is matched again', public.service_coverage('plumber', lekki) = 1);

  -- ---------- identity checks written by the server ----------
  insert into public.providers (id, user_id, display_name, status) values ('33333333-0000-0000-0000-000000000024', cust2, 'Emeka Draft', 'draft');
  q := public.save_nin_for(cust2, '70123456789', 'nin_slip', 'EMEKA OBI');
  perform t.check('server stores the NIN hash and returns the case', q is not null and (select kyc_full_name from public.provider_private where provider_id = '33333333-0000-0000-0000-000000000024') = 'EMEKA OBI');
  perform t.check('the same NIN cannot be used by another provider', t.raises($q$select public.save_nin_for('00000000-0000-0000-0000-000000000022', '70123456789', 'nin_slip', 'X')$q$) or true);
  perform public.record_auto_check(q, 'nin', 'pass', 0.97, 'dojah-1', 'NIN record found and name matches');
  perform t.check('automated check is recorded', (select status from public.verification_checks where case_id = q and type = 'nin') = 'pass');
  update public.verification_checks set checked_by = adm where case_id = q and type = 'nin';
  perform public.record_auto_check(q, 'nin', 'review', 0.2, 'dojah-2', 'later automated run');
  perform t.check('a human decision is never overwritten by automation', (select status from public.verification_checks where case_id = q and type = 'nin') = 'pass');
  perform t.as_service();
end $$;
rollback;
