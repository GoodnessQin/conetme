# ConnectMe

Verified providers (plumbers, caterers, solar installers) send offers; customers compare, accept, pay into hold, and confirm. Web first (React), mobile later (Expo) on the same backend.

Design and decisions: see the *ConnectMe: Product and Technical Blueprint v1* doc.

## What is in Phase 1

- `supabase/migrations`: 5 migrations. All tables, enums, security rules (RLS), guard triggers, storage buckets.
- `supabase/seed.sql`: 3 services, 11 areas (Lagos and Abuja), settings (commission 10%, etc.).
- `supabase/functions/send-sms-hook`: sends the login code by SMS through Termii.
- `supabase/tests/rls_assertions.sql`: 49 security checks (who can see and change what).
- `packages/shared`: money (kobo), phone, job state machine, ranking, validation. 17 unit tests.
- `packages/ui-tokens`: brand colors and Tailwind preset.
- `apps/web`: React + Vite + Tailwind PWA. Phone-code sign in, welcome, customer / provider / admin home screens, route guards.

## Run it

Requirements: Node 22, pnpm 12, Docker (for local Supabase), Supabase CLI.

```bash
pnpm install
supabase start                      # local database, auth, storage
supabase db reset                   # applies migrations + seed
cp apps/web/.env.example apps/web/.env.local   # paste URL and anon key printed by `supabase start`
pnpm dev                            # http://localhost:5173
```

### Phone login with Termii

1. Create a Termii account, register a sender ID, get an API key.
2. `cp supabase/functions/.env.example supabase/functions/.env` and fill it in. `SEND_SMS_HOOK_SECRET` comes from the Supabase dashboard when you enable the hook.
3. Local: `supabase functions serve --env-file supabase/functions/.env --no-verify-jwt`.
4. Hosted: Dashboard, Authentication, Hooks, enable **Send SMS**, choose HTTPS and point it at the deployed `send-sms-hook` function. Also turn on the Phone provider.
5. Until the hook is set up, use Supabase test phone numbers (Auth settings) to try sign-in with a fixed code.

### Make yourself admin (once)

After signing in once, run in the SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from public.profiles where phone = '+234XXXXXXXXXX';
```

## Checks

```bash
pnpm typecheck
pnpm test                    # shared unit tests
pnpm --filter @connectme/web build
./scripts/db-test.sh         # migrations + seed + 49 RLS checks against any Postgres with PostGIS
```

## Rules to keep

- Money is integer kobo. Commission is basis points in `settings`.
- Anything involving money, verification, notifications or status changes runs in an Edge Function with the service role key. The browser never holds that key.
- Chat messages have no insert policy on purpose; they go through a filtering function (Phase 5).
- Never store full NIN in plain text. Only the hash and last four digits.

## Known gaps (planned)

- `requests` lets a customer edit their own row freely. Phase 3 moves edits after acceptance into functions.
- Edge Function `send-sms-hook` is written but not run here (no Deno or Termii key in the build environment).
- Generated database types are not wired yet: `supabase gen types typescript --local > apps/web/src/lib/database.types.ts`.
- Web bundle is one chunk (about 150 KB gzipped); split routes in Phase 6.

## Test login without SMS (temporary)

Supabase can map specific phone numbers to a fixed code and skip sending SMS.
- Hosted project: Authentication, Providers, Phone, Test phone numbers and OTPs. Add `2348031234567=123456` (comma separated for more).
- Local: the `[auth.sms.test_otp]` block in `supabase/config.toml`.
Only the numbers you list get the fixed code. Remove them before real users arrive.

## Deploy to Vercel (hosted Supabase)

1. Create a Supabase project. In the SQL editor run each file in `supabase/migrations` in order, then `supabase/seed.sql`. (Or `supabase link` then `supabase db push`.)
2. Push this repo to GitHub and import it in Vercel. Leave the root directory as the repo root; `vercel.json` sets the build.
3. In Vercel, Settings, Environment Variables, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase, Project Settings, API). Redeploy.
4. In Supabase, Authentication, URL Configuration: set Site URL to your Vercel address and add it, plus `http://localhost:5173`, to Redirect URLs.

## Phase 2 and 3 (provider verification, requests and offers)

Run `supabase/migrations/20261024000001_phase2_provider_verification_and_phase3_requests.sql` once in the SQL editor.
Then: sign in as a second account, choose "I offer a service", and complete the nine registration steps.
Make one account an admin (see above) to review applications at `/admin`.

Test mode: customers pay with a simulated button until Phase 4 (setting `test_payments`). Switch it off before launch:
`update settings set value = 'false' where key = 'test_payments';`

## Phase 3b (map pin, job lifecycle, ratings, disputes)

Run `supabase/migrations/20261025000001_phase3b_map_pin_lifecycle_ratings.sql` after the Phase 2 and 3 migration.
Run `pnpm install` once: it adds the map library (leaflet). Maps use OpenStreetMap tiles, which are free and need no key.
For heavy production traffic, switch to a paid tile provider or Google Maps.

## Phase 3c (services, demand, coverage, admin review rules)

Run `supabase/migrations/20261026000001_phase3c_services_admin_coverage.sql`.
Admins can add any service in the app (Admin, Services). Customers who ask for a service that is not offered, or search an area with no providers, are told so, and the request is recorded under Admin, Services, Customer demand.
Nobody can review or approve their own provider application: use a separate admin account.

## Phase 4 (payments, ledger, chat, quotes, alerts, identity)

Run `supabase/migrations/20261027000001_phase4_payments_ledger_chat_quotes.sql` after the earlier migrations.
The app keeps working in test mode with no server functions. See `supabase/functions/README.md` to add Paystack, SMS and identity checks one by one,
and `docs/GO-LIVE-CHECKLIST.md` before taking real money.
