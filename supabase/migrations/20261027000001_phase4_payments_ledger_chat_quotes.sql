-- Phase 4: payments ledger, payouts, refunds, cancellation, scheduled jobs, chat, solar quotes, admin tools, KYC hooks.
-- Run once in the Supabase SQL editor after 20261026000001.
-- Money is only ever moved by these server-side functions. The browser cannot change a payment, payout or ledger row.

-- =====================================================================
-- Settings, columns, tables
-- =====================================================================
insert into public.settings (key, value, description) values
  ('payment_mode', '"test"', 'test = simulated payments. paystack = real checkout. Set to paystack only when keys and legal sign-off are in place.'),
  ('payout_delay_hours', '0', 'Hours between customer confirmation and the provider payout (a buffer against chargebacks)'),
  ('payout_approval_threshold_kobo', '50000000', 'Payouts at or above this need finance approval (NGN 500,000)'),
  ('stale_unpaid_hours', '24', 'Accepted jobs that are still unpaid after this many hours are cancelled')
on conflict (key) do nothing;

alter table public.profiles add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists sms_alerts boolean not null default true;
alter table public.provider_private add column if not exists bank_code text,
  add column if not exists paystack_recipient_code text,
  add column if not exists kyc_full_name text;
alter table public.payments add column if not exists provider text not null default 'paystack',
  add column if not exists fee_kobo bigint not null default 0,
  add column if not exists customer_id uuid references public.profiles(id),
  add column if not exists paid_at timestamptz;
alter table public.payouts add column if not exists reference text unique,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists attempts int not null default 0,
  add column if not exists last_error text,
  add column if not exists locked_at timestamptz,
  add column if not exists needs_approval boolean not null default false,
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists processed_at timestamptz,
  add column if not exists fee_kobo bigint not null default 0;
alter table public.refunds add column if not exists payment_id uuid references public.payments(id),
  add column if not exists attempts int not null default 0,
  add column if not exists last_error text,
  add column if not exists locked_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists processor_reference text;

create table if not exists public.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event text not null,
  reference text,
  payload jsonb not null,
  processed boolean not null default false,
  error text,
  received_at timestamptz not null default now()
);
create unique index if not exists webhook_events_dedupe on public.webhook_events (provider, event, reference) where reference is not null;
alter table public.webhook_events enable row level security;
create policy webhooks_finance on public.webhook_events for select to authenticated using (public.has_role('finance') or public.is_admin());

-- Append-only double-entry ledger. Corrections are new entries, never edits.
create table if not exists public.ledger_entries (
  id bigint generated always as identity primary key,
  txn_id uuid not null,
  account text not null check (account in ('cash','held','payable','refund_payable','commission','fees')),
  direction text not null check (direction in ('debit','credit')),
  amount_kobo bigint not null check (amount_kobo > 0),
  ref_type text, ref_id uuid, job_id uuid, memo text,
  created_at timestamptz not null default now()
);
create index if not exists ledger_job_idx on public.ledger_entries (job_id);
alter table public.ledger_entries enable row level security;
create policy ledger_finance on public.ledger_entries for select to authenticated using (public.has_role('finance') or public.is_admin());
create or replace function public.ledger_immutable() returns trigger language plpgsql as $$
begin raise exception 'The ledger is append-only. Post a correcting entry instead.'; end $$;
create trigger ledger_no_change before update or delete on public.ledger_entries for each row execute function public.ledger_immutable();

create or replace function public.post_ledger(p_ref_type text, p_ref_id uuid, p_job uuid, p_memo text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare t uuid := gen_random_uuid(); d bigint; c bigint; l jsonb;
begin
  select coalesce(sum((x->>'amount')::bigint) filter (where x->>'dir' = 'debit'), 0),
         coalesce(sum((x->>'amount')::bigint) filter (where x->>'dir' = 'credit'), 0) into d, c from jsonb_array_elements(p_lines) x;
  if d <> c or d = 0 then raise exception 'Ledger entry does not balance (debits %, credits %).', d, c; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l->>'amount')::bigint > 0 then
      insert into public.ledger_entries (txn_id, account, direction, amount_kobo, ref_type, ref_id, job_id, memo)
      values (t, l->>'account', l->>'dir', (l->>'amount')::bigint, p_ref_type, p_ref_id, p_job, p_memo);
    end if;
  end loop;
  return t;
end $$;

-- Quotes (solar: after the paid site inspection the provider sends a full quote)
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  price_kobo bigint not null check (price_kobo > 0),
  scope text not null,
  status text not null default 'sent' check (status in ('sent','accepted','declined','expired')),
  valid_until timestamptz not null,
  follow_up_job_id uuid references public.jobs(id),
  created_at timestamptz not null default now()
);
alter table public.quotes enable row level security;
create policy quotes_parties on public.quotes for select to authenticated using (public.is_job_party(job_id) or public.is_staff());

-- =====================================================================
-- Money movement helpers (never callable from the browser)
-- =====================================================================
create or replace function public.settle_milestone_payment(p_milestone uuid, p_payment uuid, p_fee bigint, p_actor uuid, p_memo text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare m public.job_milestones%rowtype; j public.jobs%rowtype;
begin
  select * into m from public.job_milestones where id = p_milestone for update;
  if m.id is null or m.status <> 'pending' then raise exception 'This payment was already applied.'; end if;
  if p_fee < 0 or p_fee > m.amount_kobo then raise exception 'Invalid processing fee.'; end if;
  select * into j from public.jobs where id = m.job_id for update;
  update public.job_milestones set status = 'paid_held' where id = m.id;
  if j.status = 'awaiting_payment' then
    update public.jobs set status = 'paid_held' where id = j.id;
    insert into public.notifications (user_id, type, payload)
    select p.user_id, 'job_paid', jsonb_build_object('job_id', j.id) from public.providers p where p.id = j.provider_id;
  end if;
  insert into public.job_events (job_id, actor_id, event, note)
  values (j.id, p_actor, 'payment_held', m.label || ': NGN ' || to_char(m.amount_kobo / 100, 'FM999,999,999') || ' paid and held by ConnectMe' || case when p_memo = 'test' then ' (test mode).' else '.' end);
  perform public.post_ledger('payment', p_payment, j.id, p_memo, jsonb_build_array(
    jsonb_build_object('account', 'cash', 'dir', 'debit', 'amount', m.amount_kobo - p_fee),
    jsonb_build_object('account', 'fees', 'dir', 'debit', 'amount', p_fee),
    jsonb_build_object('account', 'held', 'dir', 'credit', 'amount', m.amount_kobo)));
end $$;

create or replace function public.internal_release(p_milestone uuid, p_gross bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; comm bigint; net bigint; delay_h int; thresh bigint; pid uuid;
begin
  select jb.* into j from public.jobs jb join public.job_milestones m on m.job_id = jb.id where m.id = p_milestone;
  comm := round(p_gross * j.commission_bps / 10000.0); net := p_gross - comm;
  select coalesce((select value::text::int from public.settings where key = 'payout_delay_hours'), 0) into delay_h;
  select coalesce((select value::text::bigint from public.settings where key = 'payout_approval_threshold_kobo'), 50000000) into thresh;
  insert into public.payouts (milestone_id, provider_id, gross_kobo, commission_kobo, net_kobo, reference, available_at, needs_approval)
  values (p_milestone, j.provider_id, p_gross, comm, net, 'po-' || replace(gen_random_uuid()::text, '-', ''), now() + make_interval(hours => delay_h), net >= thresh)
  on conflict (milestone_id) do nothing returning id into pid;
  if pid is null then return; end if;
  perform public.post_ledger('release', p_milestone, j.id, 'Released to provider', jsonb_build_array(
    jsonb_build_object('account', 'held', 'dir', 'debit', 'amount', p_gross),
    jsonb_build_object('account', 'payable', 'dir', 'credit', 'amount', net),
    jsonb_build_object('account', 'commission', 'dir', 'credit', 'amount', comm)));
end $$;

create or replace function public.internal_refund(p_milestone uuid, p_amount bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; pay uuid;
begin
  if p_amount <= 0 then return; end if;
  select jb.* into j from public.jobs jb join public.job_milestones m on m.job_id = jb.id where m.id = p_milestone;
  select id into pay from public.payments where milestone_id = p_milestone and status = 'success' order by paid_at desc nulls last limit 1;
  insert into public.refunds (milestone_id, amount_kobo, reason, payment_id) values (p_milestone, p_amount, p_reason, pay);
  perform public.post_ledger('refund', p_milestone, j.id, p_reason, jsonb_build_array(
    jsonb_build_object('account', 'held', 'dir', 'debit', 'amount', p_amount),
    jsonb_build_object('account', 'refund_payable', 'dir', 'credit', 'amount', p_amount)));
end $$;

-- Release every held milestone to the provider (customer confirmed, or auto-confirmed)
create or replace function public.release_milestones(p_job uuid, p_new_status job_status, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; m record; total_net bigint := 0;
begin
  select * into j from public.jobs where id = p_job;
  for m in select * from public.job_milestones where job_id = p_job and status = 'paid_held' loop
    perform public.internal_release(m.id, m.amount_kobo);
    update public.job_milestones set status = 'released' where id = m.id;
    total_net := total_net + (m.amount_kobo - round(m.amount_kobo * j.commission_bps / 10000.0));
  end loop;
  update public.jobs set status = p_new_status, completed_at = now() where id = p_job;
  perform set_config('app.bypass_guard', 'on', true);
  update public.providers set jobs_completed = jobs_completed + 1 where id = j.provider_id;
  perform set_config('app.bypass_guard', 'off', true);
  insert into public.job_events (job_id, actor_id, event, note) values (p_job, auth.uid(), 'paid_out', p_note);
  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'payment_released', jsonb_build_object('job_id', p_job, 'net_kobo', total_net) from public.providers p where p.id = j.provider_id;
end $$;

-- Dispute outcomes now use the same ledger-aware helpers
create or replace function public.admin_resolve_dispute(p_dispute uuid, p_resolution text, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare d public.disputes%rowtype; j public.jobs%rowtype; m record; half bigint; final job_status; prov_user uuid;
begin
  if not (public.has_role('support') or public.is_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_resolution not in ('refund_customer','pay_provider','split_50_50') then raise exception 'Unknown outcome.'; end if;
  if length(trim(coalesce(p_note, ''))) < 10 then raise exception 'Write a clear note explaining the decision. Both people will see it.'; end if;
  select * into d from public.disputes where id = p_dispute for update;
  if d.id is null or d.status <> 'open' then raise exception 'This dispute is already resolved.'; end if;
  select * into j from public.jobs where id = d.job_id for update;
  for m in select * from public.job_milestones where job_id = j.id and status = 'paid_held' loop
    if p_resolution = 'refund_customer' then
      perform public.internal_refund(m.id, m.amount_kobo, 'Dispute resolved in the customer''s favour');
      update public.job_milestones set status = 'refunded' where id = m.id;
    else
      half := case when p_resolution = 'split_50_50' then m.amount_kobo / 2 else 0 end;
      if half > 0 then perform public.internal_refund(m.id, half, 'Dispute split 50/50'); end if;
      perform public.internal_release(m.id, m.amount_kobo - half);
      update public.job_milestones set status = 'released' where id = m.id;
    end if;
  end loop;
  final := case p_resolution when 'refund_customer' then 'refunded' when 'pay_provider' then 'paid_out' else 'split_resolved' end;
  update public.jobs set status = final, completed_at = now() where id = j.id;
  perform set_config('app.bypass_guard', 'on', true);
  if p_resolution <> 'refund_customer' then update public.providers set jobs_completed = jobs_completed + 1 where id = j.provider_id; end if;
  update public.disputes set status = 'resolved', resolution = p_resolution, resolved_by = auth.uid(), resolved_note = trim(p_note) where id = d.id;
  insert into public.job_events (job_id, actor_id, event, note) values (j.id, auth.uid(), 'dispute_resolved',
    case p_resolution when 'refund_customer' then 'Resolved: the customer was refunded.' when 'pay_provider' then 'Resolved: the provider was paid.' else 'Resolved: the payment was split 50/50.' end);
  select user_id into prov_user from public.providers where id = j.provider_id;
  insert into public.notifications (user_id, type, payload)
  select u, 'dispute_resolved', jsonb_build_object('job_id', j.id, 'resolution', p_resolution, 'note', trim(p_note)) from unnest(array[j.customer_id, prov_user]) u;
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Paying: test mode and real checkout share the same settlement code
-- =====================================================================
create or replace function public.test_pay_next_milestone(p_job uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; allowed boolean; mode text; m public.job_milestones%rowtype; pay uuid := gen_random_uuid();
begin
  select (value::text = 'true') into allowed from public.settings where key = 'test_payments';
  select trim(both '"' from value::text) into mode from public.settings where key = 'payment_mode';
  if not coalesce(allowed, false) or coalesce(mode, 'test') <> 'test' then raise exception 'Test payments are switched off. Use the secure checkout.'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or j.customer_id is distinct from auth.uid() then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status not in ('awaiting_payment','paid_held','on_the_way','arrived','working','completed_by_provider') then raise exception 'This job can no longer be paid.'; end if;
  select * into m from public.job_milestones where job_id = j.id and status = 'pending' order by position limit 1;
  if m.id is null then raise exception 'Everything on this job is already paid.'; end if;
  insert into public.payments (id, milestone_id, reference, amount_kobo, status, provider, customer_id, paid_at)
  values (pay, m.id, 'test' || replace(pay::text, '-', ''), m.amount_kobo, 'success', 'test', auth.uid(), now());
  perform public.settle_milestone_payment(m.id, pay, 0, auth.uid(), 'test');
end $$;

create or replace function public.start_payment(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; m public.job_milestones%rowtype; pay uuid := gen_random_uuid(); ref text; mode text;
begin
  select trim(both '"' from value::text) into mode from public.settings where key = 'payment_mode';
  if coalesce(mode, 'test') <> 'paystack' then raise exception 'Online checkout is not switched on yet.'; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null or j.customer_id is distinct from auth.uid() then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status not in ('awaiting_payment','paid_held','on_the_way','arrived','working','completed_by_provider') then raise exception 'This job can no longer be paid.'; end if;
  select * into m from public.job_milestones where job_id = j.id and status = 'pending' order by position limit 1;
  if m.id is null then raise exception 'Everything on this job is already paid.'; end if;
  if (select count(*) from public.payments where milestone_id = m.id and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Too many payment attempts. Wait a minute and try again.'; end if;
  ref := 'cm' || replace(pay::text, '-', '');
  insert into public.payments (id, milestone_id, reference, amount_kobo, provider, customer_id) values (pay, m.id, ref, m.amount_kobo, 'paystack', auth.uid());
  return jsonb_build_object('payment_id', pay, 'reference', ref, 'amount_kobo', m.amount_kobo, 'label', m.label, 'job_id', j.id);
end $$;

-- Called by the payment webhook / verify function with the service key. Safe to call repeatedly.
create or replace function public.apply_payment_success(p_reference text, p_amount_kobo bigint, p_fee_kobo bigint, p_raw jsonb) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare pay public.payments%rowtype; m public.job_milestones%rowtype; j public.jobs%rowtype;
begin
  select * into pay from public.payments where reference = p_reference for update;
  if pay.id is null then return 'unknown_reference'; end if;
  if pay.status = 'success' then return 'already'; end if;
  if p_amount_kobo <> pay.amount_kobo then
    update public.payments set status = 'failed', raw = p_raw where id = pay.id;
    insert into public.audit_log (action, entity, entity_id, after) values ('payment_amount_mismatch', 'payments', pay.id::text, jsonb_build_object('expected', pay.amount_kobo, 'paid', p_amount_kobo));
    return 'amount_mismatch';
  end if;
  select * into m from public.job_milestones where id = pay.milestone_id for update;
  update public.payments set status = 'success', raw = p_raw, fee_kobo = greatest(coalesce(p_fee_kobo, 0), 0), paid_at = now() where id = pay.id;
  if m.status <> 'pending' then
    -- the same milestone was already paid another way: hold nothing, refund this payment in full
    select * into j from public.jobs where id = m.job_id;
    insert into public.refunds (milestone_id, amount_kobo, reason, payment_id) values (m.id, pay.amount_kobo, 'Duplicate payment', pay.id);
    perform public.post_ledger('payment', pay.id, j.id, 'Duplicate payment', jsonb_build_array(
      jsonb_build_object('account', 'cash', 'dir', 'debit', 'amount', pay.amount_kobo - least(coalesce(p_fee_kobo, 0), pay.amount_kobo)),
      jsonb_build_object('account', 'fees', 'dir', 'debit', 'amount', least(coalesce(p_fee_kobo, 0), pay.amount_kobo)),
      jsonb_build_object('account', 'refund_payable', 'dir', 'credit', 'amount', pay.amount_kobo)));
    insert into public.audit_log (action, entity, entity_id) values ('duplicate_payment_refund_queued', 'payments', pay.id::text);
    return 'duplicate_refunded';
  end if;
  perform public.settle_milestone_payment(m.id, pay.id, least(greatest(coalesce(p_fee_kobo, 0), 0), pay.amount_kobo), pay.customer_id, 'paystack');
  return 'ok';
end $$;

create or replace function public.apply_payment_failure(p_reference text, p_raw jsonb) returns void
language sql security definer set search_path = public, extensions as $$
  update public.payments set status = 'failed', raw = p_raw where reference = p_reference and status = 'initiated'
$$;

create or replace function public.log_webhook(p_provider text, p_event text, p_reference text, p_payload jsonb) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.webhook_events (provider, event, reference, payload) values (p_provider, p_event, p_reference, p_payload);
  return true;
exception when unique_violation then return false;
end $$;
create or replace function public.finish_webhook(p_provider text, p_event text, p_reference text, p_error text) returns void
language sql security definer set search_path = public, extensions as $$
  update public.webhook_events set processed = (p_error is null), error = p_error where provider = p_provider and event = p_event and reference = p_reference
$$;

-- =====================================================================
-- Payouts and refunds: claimed by the finance runner, results written back
-- =====================================================================
create or replace function public.claim_payouts(p_limit int) returns table(
  payout_id uuid, reference text, net_kobo bigint, provider_id uuid, bank_name text, bank_code text, account_number text, account_name text, recipient_code text)
language sql security definer set search_path = public, extensions as $$
  with c as (
    select p.id from public.payouts p
    where p.status = 'pending' and p.available_at <= now() and (not p.needs_approval or p.approved_by is not null)
      and (p.locked_at is null or p.locked_at < now() - interval '15 minutes') and p.attempts < 5
    order by p.created_at limit p_limit for update skip locked)
  update public.payouts po set locked_at = now(), attempts = po.attempts + 1 from c where po.id = c.id
  returning po.id, po.reference, po.net_kobo, po.provider_id,
    (select pp.bank_name from public.provider_private pp where pp.provider_id = po.provider_id),
    (select pp.bank_code from public.provider_private pp where pp.provider_id = po.provider_id),
    (select pp.bank_account_number from public.provider_private pp where pp.provider_id = po.provider_id),
    (select pp.bank_account_name from public.provider_private pp where pp.provider_id = po.provider_id),
    (select pp.paystack_recipient_code from public.provider_private pp where pp.provider_id = po.provider_id)
$$;

create or replace function public.save_recipient_code(p_provider uuid, p_bank_code text, p_recipient text) returns void
language sql security definer set search_path = public, extensions as $$
  update public.provider_private set bank_code = coalesce(p_bank_code, bank_code), paystack_recipient_code = p_recipient where provider_id = p_provider
$$;

create or replace function public.mark_payout_sent(p_payout uuid, p_transfer_code text, p_fee bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare po public.payouts%rowtype; jid uuid; puser uuid; fee bigint := greatest(coalesce(p_fee, 0), 0);
begin
  select * into po from public.payouts where id = p_payout for update;
  if po.id is null or po.status = 'sent' then return; end if;
  update public.payouts set status = 'sent', transfer_code = p_transfer_code, processed_at = now(), fee_kobo = fee, locked_at = null, last_error = null where id = po.id;
  select m.job_id into jid from public.job_milestones m where m.id = po.milestone_id;
  perform public.post_ledger('payout', po.id, jid, 'Paid to provider', jsonb_build_array(
    jsonb_build_object('account', 'payable', 'dir', 'debit', 'amount', po.net_kobo),
    jsonb_build_object('account', 'fees', 'dir', 'debit', 'amount', fee),
    jsonb_build_object('account', 'cash', 'dir', 'credit', 'amount', po.net_kobo + fee)));
  select user_id into puser from public.providers where id = po.provider_id;
  insert into public.job_events (job_id, actor_id, event, note) values (jid, null, 'payout_sent', 'Payout of NGN ' || to_char(po.net_kobo / 100, 'FM999,999,999') || ' sent to the provider.');
  insert into public.notifications (user_id, type, payload) values (puser, 'payout_sent', jsonb_build_object('job_id', jid, 'net_kobo', po.net_kobo));
end $$;

create or replace function public.mark_payout_failed(p_payout uuid, p_error text, p_final boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare po public.payouts%rowtype;
begin
  select * into po from public.payouts where id = p_payout for update;
  if po.id is null or po.status = 'sent' then return; end if;
  update public.payouts set last_error = left(p_error, 500), locked_at = null,
    status = case when p_final or po.attempts >= 5 then 'failed'::payout_status else po.status end where id = po.id;
  if p_final or po.attempts >= 5 then
    insert into public.audit_log (action, entity, entity_id, after) values ('payout_failed', 'payouts', po.id::text, jsonb_build_object('error', left(p_error, 500)));
  end if;
end $$;

create or replace function public.claim_refunds(p_limit int) returns table(refund_id uuid, amount_kobo bigint, payment_reference text, payment_provider text)
language sql security definer set search_path = public, extensions as $$
  with c as (
    select r.id from public.refunds r
    where r.status = 'pending' and (r.locked_at is null or r.locked_at < now() - interval '15 minutes') and r.attempts < 5
    order by r.created_at limit p_limit for update skip locked)
  update public.refunds rf set locked_at = now(), attempts = rf.attempts + 1 from c where rf.id = c.id
  returning rf.id, rf.amount_kobo, (select pay.reference from public.payments pay where pay.id = rf.payment_id), (select pay.provider from public.payments pay where pay.id = rf.payment_id)
$$;

create or replace function public.mark_refund_sent(p_refund uuid, p_reference text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare rf public.refunds%rowtype; jid uuid;
begin
  select * into rf from public.refunds where id = p_refund for update;
  if rf.id is null or rf.status = 'sent' then return; end if;
  update public.refunds set status = 'sent', processed_at = now(), processor_reference = p_reference, locked_at = null, last_error = null where id = rf.id;
  select m.job_id into jid from public.job_milestones m where m.id = rf.milestone_id;
  perform public.post_ledger('refund_paid', rf.id, jid, 'Refund sent to the customer', jsonb_build_array(
    jsonb_build_object('account', 'refund_payable', 'dir', 'debit', 'amount', rf.amount_kobo),
    jsonb_build_object('account', 'cash', 'dir', 'credit', 'amount', rf.amount_kobo)));
  insert into public.notifications (user_id, type, payload)
  select j.customer_id, 'refund_sent', jsonb_build_object('job_id', j.id, 'amount_kobo', rf.amount_kobo) from public.jobs j where j.id = jid;
end $$;

create or replace function public.mark_refund_failed(p_refund uuid, p_error text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare rf public.refunds%rowtype;
begin
  select * into rf from public.refunds where id = p_refund for update;
  if rf.id is null or rf.status = 'sent' then return; end if;
  update public.refunds set last_error = left(p_error, 500), locked_at = null, status = case when rf.attempts >= 5 then 'failed'::payout_status else rf.status end where id = rf.id;
end $$;

-- Finance staff actions
create or replace function public.finance_ok() returns boolean language sql stable security definer set search_path = public, extensions as $$
  select public.has_role('finance') or public.is_admin() $$;

create or replace function public.finance_approve_payout(p_payout uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.finance_ok() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.payouts set approved_by = auth.uid() where id = p_payout and status = 'pending' and needs_approval;
  insert into public.audit_log (actor_id, action, entity, entity_id) values (auth.uid(), 'payout_approved', 'payouts', p_payout::text);
end $$;

create or replace function public.finance_mark_payout_sent(p_payout uuid, p_reference text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare po public.payouts%rowtype;
begin
  if not public.finance_ok() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into po from public.payouts where id = p_payout;
  if po.id is null or po.status = 'sent' then raise exception 'This payout is not waiting to be sent.'; end if;
  if po.needs_approval and po.approved_by is null then raise exception 'Approve this large payout first.'; end if;
  if length(trim(coalesce(p_reference, ''))) < 4 then raise exception 'Enter the bank transfer reference.'; end if;
  perform public.mark_payout_sent(p_payout, 'manual:' || trim(p_reference), 0);
  insert into public.audit_log (actor_id, action, entity, entity_id, after) values (auth.uid(), 'payout_marked_sent_manually', 'payouts', p_payout::text, jsonb_build_object('reference', p_reference));
end $$;

create or replace function public.finance_retry_payout(p_payout uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.finance_ok() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.payouts set status = 'pending', attempts = 0, locked_at = null, last_error = null where id = p_payout and status = 'failed';
  insert into public.audit_log (actor_id, action, entity, entity_id) values (auth.uid(), 'payout_retry', 'payouts', p_payout::text);
end $$;

-- Test mode only: completes due payouts and refunds without a bank
create or replace function public.finance_run_test_payouts() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare mode text; po record; rf record; np int := 0; nr int := 0;
begin
  if not public.finance_ok() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select trim(both '"' from value::text) into mode from public.settings where key = 'payment_mode';
  if coalesce(mode, 'test') <> 'test' then raise exception 'Live mode is on. Payouts are sent through the payment provider.'; end if;
  for po in select id from public.payouts where status = 'pending' and available_at <= now() and (not needs_approval or approved_by is not null) loop
    perform public.mark_payout_sent(po.id, 'test', 0); np := np + 1;
  end loop;
  for rf in select id from public.refunds where status = 'pending' loop
    perform public.mark_refund_sent(rf.id, 'test'); nr := nr + 1;
  end loop;
  return jsonb_build_object('payouts', np, 'refunds', nr);
end $$;

-- =====================================================================
-- Cancelling a job
-- =====================================================================
create or replace function public.cancel_job(p_job uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; uid uuid := auth.uid(); pid uuid := public.my_provider_id(); is_cust boolean; is_prov boolean;
        m record; fee bigint := 0; callout bigint; first boolean := true; held_total bigint; prov_user uuid; note text; other uuid;
begin
  select * into j from public.jobs where id = p_job for update;
  is_cust := j.customer_id = uid; is_prov := (pid is not null and j.provider_id = pid);
  if j.id is null or not (is_cust or is_prov) then raise exception 'Job not found.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Tell us briefly why you are cancelling.'; end if;
  select user_id into prov_user from public.providers where id = j.provider_id;
  perform set_config('app.bypass_guard', 'on', true);
  if j.status = 'awaiting_payment' then
    update public.jobs set status = 'cancelled' where id = j.id;
    note := case when is_cust then 'The customer cancelled before paying.' else 'The provider cancelled before payment.' end;
  elsif j.status in ('paid_held','on_the_way','arrived') then
    if is_cust and j.status <> 'paid_held' then
      select coalesce(s.callout_fee_kobo, 0) into callout from public.requests r join public.services s on s.id = r.service_id where r.id = j.request_id;
      select coalesce(sum(amount_kobo), 0) into held_total from public.job_milestones where job_id = j.id and status = 'paid_held';
      fee := least(callout, floor(held_total * 0.15)::bigint);
    end if;
    for m in select * from public.job_milestones where job_id = j.id and status = 'paid_held' order by position loop
      if first and fee > 0 then
        perform public.internal_release(m.id, fee);
        perform public.internal_refund(m.id, m.amount_kobo - fee, 'Job cancelled');
        update public.job_milestones set status = 'released' where id = m.id;
      else
        perform public.internal_refund(m.id, m.amount_kobo, 'Job cancelled');
        update public.job_milestones set status = 'refunded' where id = m.id;
      end if;
      first := false;
    end loop;
    update public.jobs set status = 'refunded', completed_at = now() where id = j.id;
    if is_prov then update public.providers set cancellation_count = cancellation_count + 1 where id = j.provider_id; end if;
    note := case when is_cust then 'The customer cancelled. ' || case when fee > 0 then 'A callout fee of NGN ' || to_char(fee / 100, 'FM999,999,999') || ' goes to the provider and the rest is refunded.' else 'The payment is being refunded in full.' end
            else 'The provider cancelled. The payment is being refunded in full.' end;
  else
    raise exception 'This job can no longer be cancelled. If something went wrong, report a problem instead.';
  end if;
  insert into public.job_events (job_id, actor_id, event, note) values (j.id, uid, 'cancelled', note || ' Reason: ' || trim(p_reason));
  other := case when is_cust then prov_user else j.customer_id end;
  insert into public.notifications (user_id, type, payload) values (other, 'job_cancelled', jsonb_build_object('job_id', j.id));
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Scheduled work (runs from pg_cron, never from the browser)
-- =====================================================================
create or replace function public.run_auto_confirm() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare h int; j record; n int := 0;
begin
  select coalesce((select value::text::int from public.settings where key = 'auto_confirm_hours'), 48) into h;
  for j in
    select jb.id, jb.customer_id from public.jobs jb
    where jb.status = 'completed_by_provider'
      and exists (select 1 from public.job_events e where e.job_id = jb.id and e.event = 'completed_by_provider' and e.created_at < now() - make_interval(hours => h))
      and not exists (select 1 from public.job_milestones m where m.job_id = jb.id and m.status = 'pending')
    for update skip locked
  loop
    perform public.release_milestones(j.id, 'paid_out', 'Confirmed automatically: no problem was reported within ' || h || ' hours. Payment released.');
    insert into public.notifications (user_id, type, payload) values (j.customer_id, 'auto_confirmed', jsonb_build_object('job_id', j.id));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.run_expire_requests() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  perform set_config('app.bypass_guard', 'on', true);
  update public.requests set status = 'expired' where status in ('open','offers_received') and expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  update public.offers set status = 'expired' where status = 'sent' and request_id in (select id from public.requests where status = 'expired');
  perform set_config('app.bypass_guard', 'off', true);
  return n;
end $$;

create or replace function public.run_stale_unpaid() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare h int; j record; n int := 0; puser uuid;
begin
  select coalesce((select value::text::int from public.settings where key = 'stale_unpaid_hours'), 24) into h;
  for j in select * from public.jobs where status = 'awaiting_payment' and created_at < now() - make_interval(hours => h) for update skip locked loop
    update public.jobs set status = 'cancelled' where id = j.id;
    insert into public.job_events (job_id, actor_id, event, note) values (j.id, null, 'cancelled', 'Cancelled automatically: payment was not made within ' || h || ' hours.');
    select user_id into puser from public.providers where id = j.provider_id;
    insert into public.notifications (user_id, type, payload) select u, 'job_cancelled', jsonb_build_object('job_id', j.id) from unnest(array[j.customer_id, puser]) u;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('connectme-auto-confirm', '*/15 * * * *', 'select public.run_auto_confirm()');
    perform cron.schedule('connectme-expire-requests', '*/10 * * * *', 'select public.run_expire_requests()');
    perform cron.schedule('connectme-stale-unpaid', '0 * * * *', 'select public.run_stale_unpaid()');
  else
    raise notice 'pg_cron is not available. Enable it in Database, Extensions, then run this migration again.';
  end if;
exception when others then raise notice 'Scheduling skipped: %', sqlerrm;
end $$;

-- =====================================================================
-- Chat between the customer and provider of a paid job
-- =====================================================================
create or replace function public.send_message(p_job uuid, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; uid uuid := auth.uid(); pid uuid := public.my_provider_id(); body text := trim(coalesce(p_body, '')); other uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not (j.customer_id = uid or (pid is not null and j.provider_id = pid)) then raise exception 'Job not found.' using errcode = '42501'; end if;
  if j.status in ('awaiting_payment','cancelled') then raise exception 'Chat opens once the job is paid.'; end if;
  if length(body) < 1 or length(body) > 500 then raise exception 'Messages must be between 1 and 500 characters.'; end if;
  if public.contains_contact_info(body) then
    raise exception 'Phone numbers, emails and chat app names cannot be shared here. ConnectMe keeps contact details private so you are both protected.'; end if;
  if (select count(*) from public.messages where sender_id = uid and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'You are sending messages very quickly. Wait a moment.'; end if;
  insert into public.messages (job_id, sender_id, body) values (j.id, uid, body);
  other := case when j.customer_id = uid then (select user_id from public.providers where id = j.provider_id) else j.customer_id end;
  if not exists (select 1 from public.notifications where user_id = other and type = 'new_message' and read_at is null and payload->>'job_id' = j.id::text) then
    insert into public.notifications (user_id, type, payload) values (other, 'new_message', jsonb_build_object('job_id', j.id));
  end if;
end $$;

create or replace function public.mark_messages_read(p_job uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_job_party(p_job) then return; end if;
  update public.messages set read_at = now() where job_id = p_job and sender_id <> auth.uid() and read_at is null;
  update public.notifications set read_at = now() where user_id = auth.uid() and type = 'new_message' and read_at is null and payload->>'job_id' = p_job::text;
end $$;

-- =====================================================================
-- Solar: quote after the paid site inspection
-- =====================================================================
create or replace function public.send_quote(p_job uuid, p_price_kobo bigint, p_scope text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; pid uuid := public.my_provider_id(); svc public.services%rowtype; lvl smallint; q uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or pid is null or j.provider_id <> pid then raise exception 'Job not found.' using errcode = '42501'; end if;
  select s.* into svc from public.requests r join public.services s on s.id = r.service_id where r.id = j.request_id;
  if svc.pricing_mode <> 'quote' then raise exception 'This service does not use quotes.'; end if;
  if j.status <> 'paid_out' then raise exception 'You can send the quote once the inspection is confirmed.'; end if;
  if exists (select 1 from public.quotes where job_id = j.id and status in ('sent','accepted')) then raise exception 'A quote has already been sent for this inspection.'; end if;
  select level into lvl from public.providers where id = pid;
  if lvl < 2 then raise exception 'Only verified providers can send quotes.'; end if;
  if p_price_kobo < 5000000 or p_price_kobo > svc.job_cap_kobo then raise exception 'Enter a quote between NGN 50,000 and NGN %.', to_char(svc.job_cap_kobo / 100, 'FM999,999,999'); end if;
  if length(trim(coalesce(p_scope, ''))) < 30 then raise exception 'Describe the equipment, brands, warranty and what is included (at least 30 characters).'; end if;
  if public.contains_contact_info(p_scope) then raise exception 'Remove phone numbers or emails from the quote.'; end if;
  insert into public.quotes (job_id, provider_id, price_kobo, scope, valid_until) values (j.id, pid, p_price_kobo, trim(p_scope), now() + interval '7 days') returning id into q;
  insert into public.job_events (job_id, actor_id, event, note) values (j.id, auth.uid(), 'quote_sent', 'A full quote was sent for your approval.');
  insert into public.notifications (user_id, type, payload) values (j.customer_id, 'quote_received', jsonb_build_object('job_id', j.id, 'quote_id', q));
  return q;
end $$;

create or replace function public.respond_quote(p_quote uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare q public.quotes%rowtype; j public.jobs%rowtype; r public.requests%rowtype; svc public.services%rowtype;
        nreq uuid; noff uuid; njob uuid := gen_random_uuid(); bps int; b bytea := extensions.gen_random_bytes(2);
        item jsonb; n int; i int := 0; running bigint := 0; amt bigint; puser uuid;
begin
  select * into q from public.quotes where id = p_quote for update;
  if q.id is null then raise exception 'Quote not found.'; end if;
  select * into j from public.jobs where id = q.job_id;
  if j.customer_id is distinct from auth.uid() then raise exception 'Quote not found.' using errcode = '42501'; end if;
  if q.status <> 'sent' then raise exception 'This quote has already been answered.'; end if;
  select user_id into puser from public.providers where id = q.provider_id;
  if not p_accept then
    update public.quotes set status = 'declined' where id = q.id;
    insert into public.notifications (user_id, type, payload) values (puser, 'quote_declined', jsonb_build_object('job_id', j.id));
    return null;
  end if;
  if q.valid_until < now() then update public.quotes set status = 'expired' where id = q.id; raise exception 'This quote has expired. Ask the provider for a new one.'; end if;
  select * into r from public.requests where id = j.request_id;
  select * into svc from public.services where id = r.service_id;
  select coalesce((select value::text::int from public.settings where key = 'commission_bps'), 1000) into bps;
  perform set_config('app.bypass_guard', 'on', true);
  insert into public.requests (customer_id, service_id, details, area_id, approx_location, time_slot, urgent, budget_kobo, status, expires_at)
  values (r.customer_id, r.service_id, r.details || jsonb_build_object('follow_up_of', j.id::text), r.area_id, r.approx_location, null, false, q.price_kobo, 'accepted', now())
  returning id into nreq;
  insert into public.request_private (request_id, address_text, exact_location) select nreq, address_text, exact_location from public.request_private where request_id = r.id;
  insert into public.offers (request_id, provider_id, price_kobo, message, status) values (nreq, q.provider_id, q.price_kobo, left(q.scope, 300), 'accepted') returning id into noff;
  insert into public.jobs (id, request_id, offer_id, customer_id, provider_id, total_kobo, commission_bps) values (njob, nreq, noff, j.customer_id, q.provider_id, q.price_kobo, bps);
  insert into public.job_secrets (job_id, door_code) values (njob, lpad(((get_byte(b, 0) * 256 + get_byte(b, 1)) % 10000)::text, 4, '0'));
  n := jsonb_array_length(svc.milestone_template);
  for item in select * from jsonb_array_elements(svc.milestone_template) loop
    i := i + 1;
    if i < n then amt := floor(q.price_kobo * (item->>'percent')::numeric / 100); running := running + amt; else amt := q.price_kobo - running; end if;
    insert into public.job_milestones (job_id, label, position, amount_kobo) values (njob, item->>'label', i, amt);
  end loop;
  insert into public.job_events (job_id, actor_id, event, note) values (njob, auth.uid(), 'job_created', 'Quote accepted. Waiting for payment of the first stage.');
  update public.quotes set status = 'accepted', follow_up_job_id = njob where id = q.id;
  insert into public.notifications (user_id, type, payload) values (puser, 'quote_accepted', jsonb_build_object('job_id', njob));
  perform set_config('app.bypass_guard', 'off', true);
  return njob;
end $$;

create or replace function public.job_quote(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare j public.jobs%rowtype; q public.quotes%rowtype; is_prov boolean; is_cust boolean; svc_mode text;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null then return null; end if;
  is_prov := j.provider_id = public.my_provider_id(); is_cust := j.customer_id = auth.uid();
  if not (is_prov or is_cust) then return null; end if;
  select s.pricing_mode into svc_mode from public.requests r join public.services s on s.id = r.service_id where r.id = j.request_id;
  select * into q from public.quotes where job_id = p_job or follow_up_job_id = p_job order by created_at desc limit 1;
  return jsonb_build_object('quote', case when q.id is not null then to_jsonb(q) end, 'is_quote_service', svc_mode = 'quote',
    'can_send', is_prov and svc_mode = 'quote' and j.status = 'paid_out' and (q.id is null or q.status in ('declined','expired')),
    'is_follow_up', q.id is not null and q.follow_up_job_id = p_job);
end $$;

-- =====================================================================
-- Admin: provider list, suspend and reinstate
-- =====================================================================
create or replace function public.admin_providers(p_query text) returns table(
  provider_id uuid, user_id uuid, name text, phone text, status provider_status, level smallint, rating_avg numeric, rating_count int,
  jobs_completed int, services text[], area_name text, created_at timestamptz, case_id uuid, active_jobs int)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.user_id, p.display_name, pr.phone, p.status, p.level, p.rating_avg, p.rating_count, p.jobs_completed,
         coalesce((select array_agg(s.name order by s.name) from public.provider_services ps join public.services s on s.id = ps.service_id where ps.provider_id = p.id), '{}'),
         a.name, p.created_at,
         (select c.id from public.verification_cases c where c.provider_id = p.id order by c.created_at desc limit 1),
         (select count(*)::int from public.jobs j where j.provider_id = p.id and j.status in ('paid_held','on_the_way','arrived','working','completed_by_provider','disputed'))
  from public.providers p
  join public.profiles pr on pr.id = p.user_id
  left join public.areas a on a.id = p.base_area_id
  where public.is_staff()
    and (coalesce(trim(p_query), '') = ''
         or p.display_name ilike '%' || trim(p_query) || '%'
         or (regexp_replace(coalesce(p_query, ''), '\D', '', 'g') <> '' and pr.phone like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'))
  order by p.created_at desc limit 100
$$;

create or replace function public.admin_set_provider_status(p_provider uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p public.providers%rowtype; old text;
begin
  if not public.can_verify() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into p from public.providers where id = p_provider for update;
  if p.id is null then raise exception 'Provider not found.'; end if;
  if p.user_id = auth.uid() then raise exception 'You cannot change your own provider status.' using errcode = '42501'; end if;
  if p_status not in ('suspended','approved') then raise exception 'Unknown status.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Write a clear reason (at least 10 characters). The provider will see it.'; end if;
  if p_status = 'suspended' and p.status <> 'approved' then raise exception 'Only approved providers can be suspended.'; end if;
  if p_status = 'approved' and p.status <> 'suspended' then raise exception 'Only suspended providers can be reinstated.'; end if;
  old := p.status::text;
  perform set_config('app.bypass_guard', 'on', true);
  update public.providers set status = p_status::provider_status, available_today = case when p_status = 'suspended' then false else available_today end where id = p.id;
  if p_status = 'suspended' then update public.offers set status = 'withdrawn' where provider_id = p.id and status = 'sent'; end if;
  insert into public.notifications (user_id, type, payload) values (p.user_id, case when p_status = 'suspended' then 'provider_suspended' else 'provider_reinstated' end, jsonb_build_object('reason', trim(p_reason)));
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'provider_status_changed', 'providers', p.id::text, jsonb_build_object('status', old), jsonb_build_object('status', p_status, 'reason', trim(p_reason)));
  perform set_config('app.bypass_guard', 'off', true);
end $$;

-- =====================================================================
-- Provider earnings
-- =====================================================================
create or replace function public.provider_earnings() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare pid uuid := public.my_provider_id();
begin
  if pid is null then return null; end if;
  return jsonb_build_object(
    'held_kobo', coalesce((select sum(m.amount_kobo - round(m.amount_kobo * j.commission_bps / 10000.0)) from public.job_milestones m join public.jobs j on j.id = m.job_id
                           where j.provider_id = pid and m.status = 'paid_held'), 0),
    'payable_kobo', coalesce((select sum(net_kobo) from public.payouts where provider_id = pid and status = 'pending'), 0),
    'failed_kobo', coalesce((select sum(net_kobo) from public.payouts where provider_id = pid and status = 'failed'), 0),
    'paid_kobo', coalesce((select sum(net_kobo) from public.payouts where provider_id = pid and status = 'sent'), 0),
    'payouts', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]') from (
        select jsonb_build_object('id', po.id, 'job_id', m.job_id, 'service', s.name, 'gross_kobo', po.gross_kobo, 'commission_kobo', po.commission_kobo, 'net_kobo', po.net_kobo,
               'status', po.status, 'available_at', po.available_at, 'created_at', po.created_at, 'processed_at', po.processed_at,
               'awaiting_approval', po.needs_approval and po.approved_by is null) as x
        from public.payouts po join public.job_milestones m on m.id = po.milestone_id join public.jobs j on j.id = m.job_id
        join public.requests r on r.id = j.request_id join public.services s on s.id = r.service_id
        where po.provider_id = pid order by po.created_at desc limit 40) t));
end $$;

-- =====================================================================
-- Finance views (finance and admin roles only)
-- =====================================================================
create or replace function public.finance_summary() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare cash bigint; held bigint; payable bigint; refpay bigint; comm bigint; fees bigint; eh bigint; ep bigint; er bigint;
begin
  if not public.finance_ok() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select coalesce(sum(case when direction = 'debit' then amount_kobo else -amount_kobo end) filter (where account = 'cash'), 0),
         coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end) filter (where account = 'held'), 0),
         coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end) filter (where account = 'payable'), 0),
         coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end) filter (where account = 'refund_payable'), 0),
         coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end) filter (where account = 'commission'), 0),
         coalesce(sum(case when direction = 'debit' then amount_kobo else -amount_kobo end) filter (where account = 'fees'), 0)
    into cash, held, payable, refpay, comm, fees from public.ledger_entries;
  select coalesce(sum(amount_kobo), 0) into eh from public.job_milestones where status = 'paid_held';
  select coalesce(sum(net_kobo), 0) into ep from public.payouts where status in ('pending','failed');
  select coalesce(sum(amount_kobo), 0) into er from public.refunds where status in ('pending','failed');
  return jsonb_build_object(
    'mode', (select trim(both '"' from value::text) from public.settings where key = 'payment_mode'),
    'cash_kobo', cash, 'held_kobo', held, 'payable_kobo', payable, 'refund_payable_kobo', refpay, 'commission_kobo', comm, 'fees_kobo', fees,
    'checks', jsonb_build_array(
      jsonb_build_object('name', 'Funds held match paid milestones', 'ledger', held, 'records', eh, 'ok', held = eh),
      jsonb_build_object('name', 'Provider payables match unpaid payouts', 'ledger', payable, 'records', ep, 'ok', payable = ep),
      jsonb_build_object('name', 'Refunds owed match unpaid refunds', 'ledger', refpay, 'records', er, 'ok', refpay = er),
      jsonb_build_object('name', 'Ledger balances to zero', 'ledger', cash + fees - held - payable - refpay - comm, 'records', 0, 'ok', cash + fees - held - payable - refpay - comm = 0)),
    'ok', held = eh and payable = ep and refpay = er and cash + fees - held - payable - refpay - comm = 0,
    'payouts_pending', (select count(*) from public.payouts where status = 'pending'),
    'payouts_failed', (select count(*) from public.payouts where status = 'failed'),
    'payouts_need_approval', (select count(*) from public.payouts where status = 'pending' and needs_approval and approved_by is null),
    'refunds_pending', (select count(*) from public.refunds where status = 'pending'),
    'webhook_errors', (select count(*) from public.webhook_events where not processed and error is not null));
end $$;

create or replace function public.finance_payments(p_limit int) returns table(
  payment_id uuid, reference text, amount_kobo bigint, status pay_status, provider text, fee_kobo bigint, customer_name text, job_id uuid, service_name text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select pay.id, pay.reference, pay.amount_kobo, pay.status, pay.provider, pay.fee_kobo, c.full_name, j.id, s.name, pay.created_at, pay.paid_at
  from public.payments pay join public.job_milestones m on m.id = pay.milestone_id join public.jobs j on j.id = m.job_id
  join public.profiles c on c.id = j.customer_id join public.requests r on r.id = j.request_id join public.services s on s.id = r.service_id
  where public.finance_ok() order by pay.created_at desc limit least(coalesce(p_limit, 100), 300)
$$;

create or replace function public.finance_payouts() returns table(
  payout_id uuid, job_id uuid, provider_name text, bank_name text, account_last4 text, account_name text, net_kobo bigint, status payout_status,
  available_at timestamptz, needs_approval boolean, approved boolean, attempts int, last_error text, transfer_code text, created_at timestamptz, processed_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select po.id, m.job_id, p.display_name, pp.bank_name, right(coalesce(pp.bank_account_number, ''), 4), pp.bank_account_name, po.net_kobo, po.status, po.available_at,
         po.needs_approval, po.approved_by is not null, po.attempts, po.last_error, po.transfer_code, po.created_at, po.processed_at
  from public.payouts po join public.job_milestones m on m.id = po.milestone_id join public.providers p on p.id = po.provider_id
  left join public.provider_private pp on pp.provider_id = po.provider_id
  where public.finance_ok() order by (po.status = 'pending') desc, po.created_at desc limit 200
$$;

create or replace function public.finance_refunds() returns table(
  refund_id uuid, job_id uuid, customer_name text, amount_kobo bigint, reason text, status payout_status, attempts int, last_error text, created_at timestamptz, processed_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select rf.id, m.job_id, c.full_name, rf.amount_kobo, rf.reason, rf.status, rf.attempts, rf.last_error, rf.created_at, rf.processed_at
  from public.refunds rf join public.job_milestones m on m.id = rf.milestone_id join public.jobs j on j.id = m.job_id join public.profiles c on c.id = j.customer_id
  where public.finance_ok() order by (rf.status = 'pending') desc, rf.created_at desc limit 200
$$;

create or replace function public.finance_ledger(p_limit int) returns table(
  entry_id bigint, txn_id uuid, account text, direction text, amount_kobo bigint, ref_type text, job_id uuid, memo text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select l.id, l.txn_id, l.account, l.direction, l.amount_kobo, l.ref_type, l.job_id, l.memo, l.created_at
  from public.ledger_entries l where public.finance_ok() order by l.id desc limit least(coalesce(p_limit, 100), 500)
$$;

-- =====================================================================
-- Automated identity checks: written only by the server function
-- =====================================================================
create or replace function public.save_nin_for(p_user uuid, p_nin text, p_id_type text, p_kyc_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid; pepper text; h text; cid uuid; st provider_status;
begin
  select id, status into pid, st from public.providers where user_id = p_user;
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  if st not in ('draft','needs_info') then raise exception 'Your application is already under review.'; end if;
  if p_nin !~ '^\d{11}$' then raise exception 'A National Identification Number has exactly 11 digits.'; end if;
  select value into pepper from public.app_secrets where key = 'nin_pepper';
  h := encode(extensions.digest(p_nin || pepper, 'sha256'), 'hex');
  begin
    insert into public.provider_private (provider_id, nin_hash, nin_last4, id_type, kyc_full_name)
    values (pid, h, right(p_nin, 4), p_id_type, left(p_kyc_name, 120))
    on conflict (provider_id) do update set nin_hash = excluded.nin_hash, nin_last4 = excluded.nin_last4, id_type = excluded.id_type, kyc_full_name = excluded.kyc_full_name;
  exception when unique_violation then
    raise exception 'This NIN is already linked to another ConnectMe account. If this is a mistake, contact support.';
  end;
  select id into cid from public.verification_cases where provider_id = pid order by created_at desc limit 1;
  if cid is null then insert into public.verification_cases (provider_id) values (pid) returning id into cid; end if;
  return cid;
end $$;

create or replace function public.record_auto_check(p_case uuid, p_type check_type, p_status check_status, p_score numeric, p_reference text, p_note text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into public.verification_checks (case_id, type, status, score, provider_reference, note, checked_at)
  values (p_case, p_type, p_status, p_score, p_reference, left(p_note, 500), now())
  on conflict (case_id, type) do update set status = excluded.status, score = excluded.score, provider_reference = excluded.provider_reference,
    note = excluded.note, checked_at = now()
  where public.verification_checks.checked_by is null
$$;


create or replace function public.save_bank_for(p_user uuid, p_bank text, p_bank_code text, p_number text, p_account_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid; st provider_status; cid uuid;
begin
  select id, status into pid, st from public.providers where user_id = p_user;
  if pid is null then raise exception 'Create your provider profile first.'; end if;
  if st not in ('draft','needs_info') then raise exception 'Your application is already under review.'; end if;
  if p_number !~ '^\d{10}$' then raise exception 'A Nigerian bank account number has exactly 10 digits.'; end if;
  begin
    insert into public.provider_private (provider_id, bank_name, bank_code, bank_account_number, bank_account_name, bank_account_hash, paystack_recipient_code)
    values (pid, p_bank, p_bank_code, p_number, trim(p_account_name), encode(extensions.digest(p_number, 'sha256'), 'hex'), null)
    on conflict (provider_id) do update set bank_name = excluded.bank_name, bank_code = excluded.bank_code, bank_account_number = excluded.bank_account_number,
      bank_account_name = excluded.bank_account_name, bank_account_hash = excluded.bank_account_hash, paystack_recipient_code = null;
  exception when unique_violation then
    raise exception 'This bank account is already registered to another provider.';
  end;
  select id into cid from public.verification_cases where provider_id = pid order by created_at desc limit 1;
  if cid is null then insert into public.verification_cases (provider_id) values (pid) returning id into cid; end if;
  return cid;
end $$;

-- =====================================================================
-- Permissions: server-only functions are closed to the browser, user functions are opened
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any(array[
             'post_ledger','settle_milestone_payment','internal_release','internal_refund','release_milestones','apply_payment_success','apply_payment_failure',
             'log_webhook','finish_webhook','claim_payouts','save_recipient_code','mark_payout_sent','mark_payout_failed','claim_refunds','mark_refund_sent','mark_refund_failed',
             'run_auto_confirm','run_expire_requests','run_stale_unpaid','save_nin_for','save_bank_for','record_auto_check'])
  loop execute format('revoke execute on function %s from public, anon, authenticated', f.sig); end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any(array[
             'start_payment','test_pay_next_milestone','cancel_job','send_message','mark_messages_read','send_quote','respond_quote','job_quote',
             'admin_providers','admin_set_provider_status','provider_earnings','finance_ok','finance_summary','finance_payments','finance_payouts','finance_refunds','finance_ledger',
             'finance_approve_payout','finance_mark_payout_sent','finance_retry_payout','finance_run_test_payouts','admin_resolve_dispute'])
  loop execute format('revoke execute on function %s from public, anon', f.sig); execute format('grant execute on function %s to authenticated', f.sig); end loop;
end $$;
