-- Role helpers (security definer so RLS policies can call them without recursion)
create or replace function public.has_role(r app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = r)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles
                 where user_id = auth.uid() and role in ('verifier','support','finance','admin'))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin')
$$;

create or replace function public.my_provider_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.providers where user_id = auth.uid()
$$;

-- True when the caller is the customer or provider on this job
create or replace function public.is_job_party(j uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs
                 where id = j and (customer_id = auth.uid() or provider_id = public.my_provider_id()))
$$;

-- True once the job has been paid, i.e. contact details may be shown
create or replace function public.job_is_paid(j uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs where id = j and status not in ('awaiting_payment','cancelled'))
$$;

-- New auth user -> profile + customer role
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone, full_name, email)
  values (new.id, new.phone, nullif(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'customer') on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Callers who are not staff or the service role may not touch protected columns.
create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_admin() then return new; end if;
  if new.customer_verified is distinct from old.customer_verified
     or new.phone is distinct from old.phone
     or new.id is distinct from old.id then
    raise exception 'protected profile field' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
for each row execute function public.guard_profiles();

create or replace function public.guard_providers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_staff() then
      new.status := 'draft'; new.level := 0; new.rating_avg := 0; new.rating_count := 0;
      new.jobs_completed := 0; new.response_rate := 1; new.cancellation_count := 0;
      new.no_show_count := 0; new.job_cap_kobo := 10000000;
    end if;
    return new;
  end if;
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_staff() then return new; end if;
  if new.status is distinct from old.status or new.level is distinct from old.level
     or new.rating_avg is distinct from old.rating_avg or new.rating_count is distinct from old.rating_count
     or new.jobs_completed is distinct from old.jobs_completed or new.response_rate is distinct from old.response_rate
     or new.cancellation_count is distinct from old.cancellation_count or new.no_show_count is distinct from old.no_show_count
     or new.job_cap_kobo is distinct from old.job_cap_kobo or new.user_id is distinct from old.user_id then
    raise exception 'protected provider field' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger providers_guard before insert or update on public.providers
for each row execute function public.guard_providers();

-- A provider may add a service but never approve themselves for it.
create or replace function public.guard_provider_services() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_staff() then
    if tg_op = 'INSERT' then new.status := 'submitted';
    elsif new.status is distinct from old.status then raise exception 'protected field' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger provider_services_guard before insert or update on public.provider_services
for each row execute function public.guard_provider_services();

-- Customers create requests as drafts or open only; other states belong to functions.
create or replace function public.guard_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_staff() then return new; end if;
  if tg_op = 'INSERT' and new.status not in ('draft','open') then
    raise exception 'invalid initial status' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception 'only cancel is allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger requests_guard before insert or update on public.requests
for each row execute function public.guard_requests();

-- Audit sensitive changes automatically
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger audit_user_roles after insert or update or delete on public.user_roles
for each row execute function public.audit_row();
create trigger audit_verification_cases after update on public.verification_cases
for each row execute function public.audit_row();
create trigger audit_disputes after update on public.disputes
for each row execute function public.audit_row();
create trigger audit_settings after update on public.settings
for each row execute function public.audit_row();
