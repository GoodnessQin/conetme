-- Money is always integer kobo. All timestamps are timestamptz (UTC).

-- ---------- identity ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text unique,
  email text,
  avatar_path text,
  default_area_id uuid,
  customer_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------- catalogue ----------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  icon text,
  description text,
  pricing_mode text not null check (pricing_mode in ('fixed','estimate','quote')),
  form_schema jsonb not null default '[]',
  milestone_template jsonb not null default '[{"label":"Full payment","percent":100}]',
  inspection_fee_kobo bigint not null default 0,
  callout_fee_kobo bigint not null default 0,
  job_cap_kobo bigint not null default 10000000,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  state text not null,
  location geography(Point,4326) not null,
  active boolean not null default true,
  unique (city, name)
);
alter table public.profiles add constraint profiles_area_fk foreign key (default_area_id) references public.areas(id);

-- ---------- providers ----------
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  display_name text not null,
  bio text,
  years_experience int check (years_experience between 0 and 60),
  base_area_id uuid references public.areas(id),
  base_location geography(Point,4326),
  radius_km int not null default 10 check (radius_km between 1 and 100),
  status provider_status not null default 'draft',
  level smallint not null default 0 check (level between 0 and 3),
  available_today boolean not null default false,
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  jobs_completed int not null default 0,
  response_rate numeric(4,3) not null default 1,
  cancellation_count int not null default 0,
  no_show_count int not null default 0,
  job_cap_kobo bigint not null default 10000000, -- NGN 100,000 until trusted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index providers_location_idx on public.providers using gist (base_location);
create index providers_status_idx on public.providers (status);

-- Sensitive fields live apart so ordinary policies can never expose them.
create table public.provider_private (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  nin_hash text unique,
  nin_last4 text check (nin_last4 ~ '^\d{4}$'),
  bank_recipient_code text,
  bank_account_hash text unique,
  face_hash text,
  updated_at timestamptz not null default now()
);

create table public.provider_services (
  provider_id uuid not null references public.providers(id) on delete cascade,
  service_id uuid not null references public.services(id),
  typical_price_kobo bigint check (typical_price_kobo >= 0),
  status provider_status not null default 'submitted',
  created_at timestamptz not null default now(),
  primary key (provider_id, service_id)
);

-- ---------- verification ----------
create table public.verification_cases (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  status provider_status not null default 'draft',
  submitted_at timestamptz,
  assigned_to uuid references public.profiles(id),
  decision_at timestamptz,
  rejection_reason text,
  checklist jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vcases_status_idx on public.verification_cases (status);

create table public.verification_checks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.verification_cases(id) on delete cascade,
  type check_type not null,
  status check_status not null default 'not_checked',
  score numeric(5,4),
  provider_reference text,
  note text,
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, type)
);

create table public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.verification_cases(id) on delete cascade,
  type doc_type not null,
  storage_path text not null,
  reviewed boolean not null default false,
  uploaded_at timestamptz not null default now()
);

create table public.guarantors (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null unique references public.providers(id) on delete cascade,
  name text not null,
  phone text not null,
  relationship text not null,
  address text,
  years_known int,
  confirmed_at timestamptz,
  declaration_version text,
  created_at timestamptz not null default now()
);

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  service_id uuid references public.services(id),
  photo_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

-- ---------- requests and offers ----------
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  service_id uuid not null references public.services(id),
  details jsonb not null default '{}',
  area_id uuid references public.areas(id),
  approx_location geography(Point,4326),    -- rounded; safe for providers to see
  time_slot timestamptz,
  urgent boolean not null default false,
  budget_kobo bigint check (budget_kobo >= 0),
  status request_status not null default 'draft',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_customer_idx on public.requests (customer_id);
create index requests_open_idx on public.requests (service_id, status);

create table public.request_private (
  request_id uuid primary key references public.requests(id) on delete cascade,
  address_text text not null,
  exact_location geography(Point,4326)
);

create table public.request_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  storage_path text not null
);

create table public.request_recipients (
  request_id uuid not null references public.requests(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  notified_at timestamptz not null default now(),
  viewed_at timestamptz,
  responded boolean not null default false,
  primary key (request_id, provider_id)
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  price_kobo bigint not null check (price_kobo > 0),
  start_at timestamptz,
  message text,
  status offer_status not null default 'sent',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, provider_id)
);

-- ---------- jobs and money ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.requests(id),
  offer_id uuid not null unique references public.offers(id),
  customer_id uuid not null references public.profiles(id),
  provider_id uuid not null references public.providers(id),
  total_kobo bigint not null check (total_kobo > 0),
  commission_bps int not null check (commission_bps between 0 and 10000),
  status job_status not null default 'awaiting_payment',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_provider_idx on public.jobs (provider_id);

-- The door code. Readable by the customer only; the provider types it in, a function checks it.
create table public.job_secrets (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  door_code text not null check (door_code ~ '^\d{4}$')
);

create table public.job_milestones (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  label text not null,
  position int not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  status milestone_status not null default 'pending',
  due_at timestamptz,
  unique (job_id, position)
);

create table public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event text not null,
  note text,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.job_milestones(id),
  reference text not null unique,
  amount_kobo bigint not null check (amount_kobo > 0),
  status pay_status not null default 'initiated',
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null unique references public.job_milestones(id),
  provider_id uuid not null references public.providers(id),
  gross_kobo bigint not null,
  commission_kobo bigint not null,
  net_kobo bigint not null,
  transfer_code text,
  status payout_status not null default 'pending',
  created_at timestamptz not null default now(),
  check (gross_kobo = commission_kobo + net_kobo)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.job_milestones(id),
  amount_kobo bigint not null check (amount_kobo > 0),
  reason text not null,
  status payout_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  opened_by uuid not null references public.profiles(id),
  reason dispute_reason not null,
  detail text,
  status dispute_status not null default 'open',
  resolution text check (resolution in ('refund_customer','pay_provider','split_50_50')),
  resolved_by uuid references public.profiles(id),
  resolved_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  reviewer_id uuid not null references public.profiles(id),
  reviewee_id uuid not null references public.profiles(id),
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (job_id, reviewer_id)
);

-- ---------- communication ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_job_idx on public.messages (job_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  channel_results jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  platform text not null check (platform in ('web','ios','android')),
  created_at timestamptz not null default now()
);

-- ---------- admin ----------
create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','services','providers','verification_cases','requests','offers','jobs','payments','disputes','settings','provider_private']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t||'_updated', t);
  end loop;
end $$;
