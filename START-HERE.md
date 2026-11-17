# ConnectMe update 6: public marketplace, states and areas, Google sign-in

## What is new
- The front page is now the marketplace. Anyone can browse and search providers without signing in. An account is asked for only when someone posts a request, books, or saves a provider.
- State dropdown, then a searchable area list for that state, everywhere (home, request, provider registration, provider profile). Dropping a pin fills them in. Admin launches states one at a time (Admin, Locations).
- Provider pages have a banner, tagline, heart (recommend) and share button, and a public link `connectme.ng/pro/their-name`.
- Providers add or change a banner from Provider profile. It goes to the admin Changes queue (shows current and requested side by side) before it goes live.
- Admin, Banners: homepage banners, category pictures, featured providers.
- Become a provider page, and a Help and FAQ page with practical answers.
- Continue with Google next to phone sign-in. Google users add and confirm a phone number during provider registration.
- The sign-in screen now says what went wrong when the code cannot be sent.

## 1. Copy the files
Unzip this folder over your project, replacing files when asked. Delete `apps/web/src/pages/Landing.tsx` if it still exists.

## 2. Database (Supabase, SQL editor), run in this order
1. `supabase/migrations/20261029000001_locations.sql`
2. `supabase/migrations/20261030000001_marketplace.sql`

Run each once (paste the whole file, press Run). Then open `supabase/seed.sql`, copy only the last 3 `update public.services set keywords ...` statements and run them too, only if searches like "leaking tap" find no plumbers.

## 3. Fix "Send code" errors (the "Something went wrong" screen)
In Supabase: Authentication, Sign In / Providers, Phone. If you use test numbers, the field "Test OTPs valid until" has an end date. When it passes, codes stop working. Set it far in the future (a date next year), and Save.

## 4. Turn on Google sign-in (10 minutes, optional)
1. Google Cloud Console, create a project, APIs and Services, OAuth consent screen: app name ConnectMe, your support email. Publish it.
2. Credentials, Create credentials, OAuth client ID, type Web application. Under Authorized redirect URIs add the URL Supabase shows you on Authentication, Sign In / Providers, Google ("Callback URL"). Copy the Client ID and Client secret.
3. In Supabase paste both into the Google provider and switch it on.
4. Supabase, Authentication, URL Configuration: Site URL `https://connectme.ng`, and add `https://connectme.ng/**` and your Vercel preview address to Redirect URLs.

## 5. Push to GitHub
```
git add -A
git commit -m "Public marketplace, locations, banners, Google sign-in"
git push
```
Vercel deploys by itself.

## 6. Launch your first states
Sign in as admin, Admin, Locations. Lagos and FCT are already live. Rivers and Oyo have sample areas and are hidden: add or edit areas, then switch the state on. Add homepage banners and category pictures under Admin, Banners.

## Tests that passed
322 database checks, 23 shared-logic tests, TypeScript and production build clean.
