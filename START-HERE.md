# ConnectMe update 5

1. Copy everything in this folder over your project (same paths), choose Replace. Keep node_modules and apps\web\.env.local.
2. Supabase, SQL Editor, new query, paste and run this one file. It must say Success:
   supabase\migrations\20261028000001_phase5_monitoring_profiles_matching.sql
   It also fixes a permission bug in the job, dispute and rating checks, so run it before real users arrive.
3. Test locally: pnpm dev   (Ctrl+Shift+R in the browser). If you only run it on Vercel, skip to step 4.
4. Put it live:   git add .   then   git commit -m "Update 5"   then   git push      Vercel publishes by itself in about a minute.

## What is new
- Navigation: icon and label turn blue, no blue button.
- Customers: choose who quotes (everyone who fits, or up to 3 providers), provider profile with Reviews, Work and About tabs,
  rating labels (Terrible to Excellent) with tags, "Share my number for this job" and quick messages for arrival.
- Providers: separate Provider profile page (bio, prices, work photos, reviews, change requests), photo and area changes are approved by admin.
- Admin: People (providers and customers, suspend), Activity (requests, offers, jobs), job detail with payments and timeline, profile changes tab in Verify.
- Admin roles: People and Activity need the support or admin role. Your admin account has it.

## Domain
Read docs\DOMAIN-AND-DEPLOY.md to put connectme.ng on the app.
