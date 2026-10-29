-- Row level security. Rule of thumb: money tables and status fields are written
-- only by Edge Functions (service role). The browser never holds that key.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_roles','services','areas','providers','provider_private','provider_services',
    'verification_cases','verification_checks','verification_documents','guarantors','portfolio_items',
    'requests','request_private','request_photos','request_recipients','offers',
    'jobs','job_secrets','job_milestones','job_events','payments','payouts','refunds',
    'disputes','reviews','messages','notifications','push_subscriptions','settings','audit_log']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff()
         or exists (select 1 from public.providers p where p.user_id = profiles.id and p.status = 'approved'));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_roles: read own, admin manages
create policy roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy roles_admin_write on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- catalogue: public read, admin write
create policy services_read on public.services for select to anon, authenticated using (active or public.is_staff());
create policy services_admin on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy areas_read on public.areas for select to anon, authenticated using (active or public.is_staff());
create policy areas_admin on public.areas for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- providers: approved profiles are visible to signed-in users; own row always
create policy providers_select on public.providers for select to authenticated
  using (status = 'approved' or user_id = auth.uid() or public.is_staff());
create policy providers_insert_own on public.providers for insert to authenticated with check (user_id = auth.uid());
create policy providers_update_own on public.providers for update to authenticated
  using (user_id = auth.uid() or public.is_staff()) with check (user_id = auth.uid() or public.is_staff());

-- provider_private: staff only. Providers never read their own NIN hash back.
create policy pprivate_staff on public.provider_private for select to authenticated using (public.is_staff());

create policy pservices_select on public.provider_services for select to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff()
         or (status = 'approved' and exists (select 1 from public.providers p where p.id = provider_id and p.status = 'approved')));
create policy pservices_write_own on public.provider_services for all to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff())
  with check (provider_id = public.my_provider_id() or public.is_staff());

-- verification: provider sees own case status; staff see and decide
create policy vcases_select on public.verification_cases for select to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff());
create policy vcases_insert_own on public.verification_cases for insert to authenticated
  with check (provider_id = public.my_provider_id());
create policy vcases_staff_update on public.verification_cases for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy vchecks_staff on public.verification_checks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy vdocs_select on public.verification_documents for select to authenticated
  using (public.is_staff() or exists (select 1 from public.verification_cases c where c.id = case_id and c.provider_id = public.my_provider_id()));
create policy vdocs_insert_own on public.verification_documents for insert to authenticated
  with check (exists (select 1 from public.verification_cases c where c.id = case_id and c.provider_id = public.my_provider_id()));
create policy vdocs_staff_update on public.verification_documents for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy guarantors_select on public.guarantors for select to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff());
create policy guarantors_insert_own on public.guarantors for insert to authenticated
  with check (provider_id = public.my_provider_id() and confirmed_at is null);
create policy guarantors_staff_update on public.guarantors for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy portfolio_select on public.portfolio_items for select to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff()
         or exists (select 1 from public.providers p where p.id = provider_id and p.status = 'approved'));
create policy portfolio_write_own on public.portfolio_items for all to authenticated
  using (provider_id = public.my_provider_id()) with check (provider_id = public.my_provider_id());

-- requests: customers own theirs; providers see only requests sent to them
create policy requests_customer on public.requests for all to authenticated
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy requests_recipient on public.requests for select to authenticated
  using (exists (select 1 from public.request_recipients r where r.request_id = id and r.provider_id = public.my_provider_id()));
create policy requests_staff on public.requests for select to authenticated using (public.is_staff());

-- exact address: customer always; provider only after the job is paid
create policy rprivate_customer on public.request_private for all to authenticated
  using (exists (select 1 from public.requests q where q.id = request_id and q.customer_id = auth.uid()))
  with check (exists (select 1 from public.requests q where q.id = request_id and q.customer_id = auth.uid()));
create policy rprivate_provider on public.request_private for select to authenticated
  using (exists (select 1 from public.jobs j
                 where j.request_id = request_private.request_id
                   and j.provider_id = public.my_provider_id()
                   and j.status not in ('awaiting_payment','cancelled')));

create policy rphotos_customer on public.request_photos for all to authenticated
  using (exists (select 1 from public.requests q where q.id = request_id and q.customer_id = auth.uid()))
  with check (exists (select 1 from public.requests q where q.id = request_id and q.customer_id = auth.uid()));
create policy rphotos_recipient on public.request_photos for select to authenticated
  using (exists (select 1 from public.request_recipients r where r.request_id = request_photos.request_id and r.provider_id = public.my_provider_id()));

create policy recipients_select on public.request_recipients for select to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff());
create policy recipients_mark_viewed on public.request_recipients for update to authenticated
  using (provider_id = public.my_provider_id()) with check (provider_id = public.my_provider_id());

-- offers: approved provider who was notified may offer; customer sees offers on own request
create policy offers_provider_select on public.offers for select to authenticated
  using (provider_id = public.my_provider_id() or public.is_staff());
create policy offers_customer_select on public.offers for select to authenticated
  using (exists (select 1 from public.requests q where q.id = request_id and q.customer_id = auth.uid()));
create policy offers_provider_insert on public.offers for insert to authenticated
  with check (
    provider_id = public.my_provider_id() and status = 'sent'
    and exists (select 1 from public.providers p where p.id = provider_id and p.status = 'approved')
    and exists (select 1 from public.request_recipients r where r.request_id = offers.request_id and r.provider_id = offers.provider_id));
create policy offers_provider_withdraw on public.offers for update to authenticated
  using (provider_id = public.my_provider_id() and status = 'sent')
  with check (provider_id = public.my_provider_id() and status in ('sent','withdrawn'));

-- jobs and money: read by parties; written only by functions
create policy jobs_select on public.jobs for select to authenticated
  using (customer_id = auth.uid() or provider_id = public.my_provider_id() or public.is_staff());
create policy jsecrets_customer on public.job_secrets for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and j.customer_id = auth.uid()));
create policy milestones_select on public.job_milestones for select to authenticated
  using (public.is_job_party(job_id) or public.is_staff());
create policy jevents_select on public.job_events for select to authenticated
  using (public.is_job_party(job_id) or public.is_staff());
create policy payments_select on public.payments for select to authenticated
  using (public.has_role('finance') or public.is_admin()
         or exists (select 1 from public.job_milestones m join public.jobs j on j.id = m.job_id
                    where m.id = milestone_id and j.customer_id = auth.uid()));
create policy payouts_select on public.payouts for select to authenticated
  using (provider_id = public.my_provider_id() or public.has_role('finance') or public.is_admin());
create policy refunds_select on public.refunds for select to authenticated
  using (public.has_role('finance') or public.is_admin()
         or exists (select 1 from public.job_milestones m join public.jobs j on j.id = m.job_id
                    where m.id = milestone_id and j.customer_id = auth.uid()));

-- disputes
create policy disputes_select on public.disputes for select to authenticated
  using (public.is_job_party(job_id) or public.is_staff());
create policy disputes_insert on public.disputes for insert to authenticated
  with check (opened_by = auth.uid() and public.is_job_party(job_id) and status = 'open' and resolution is null);
create policy disputes_staff_update on public.disputes for update to authenticated
  using (public.has_role('support') or public.is_admin()) with check (public.has_role('support') or public.is_admin());

-- reviews: public read (ratings feed ranking); written by job parties after payout
create policy reviews_select on public.reviews for select to authenticated using (true);
create policy reviews_insert on public.reviews for insert to authenticated
  with check (reviewer_id = auth.uid() and public.is_job_party(job_id)
              and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'paid_out'));

-- chat: read by job parties once paid. Inserts go through the chat-send function
-- so phone numbers and off-app phrases are filtered; there is deliberately no insert policy.
create policy messages_select on public.messages for select to authenticated
  using (public.is_job_party(job_id) and public.job_is_paid(job_id));

create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_admin on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy audit_admin on public.audit_log for select to authenticated using (public.is_admin());
