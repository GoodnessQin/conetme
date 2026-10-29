# ConnectMe update 4: payments, chat, quotes, alerts, identity, finance

1. Copy everything in this folder over your project (same paths) and choose Replace.
   Do not delete node_modules or apps\web\.env.local.
2. Supabase, SQL Editor, new query, paste and run these files in order. Run only the ones you have not run yet. Each must say Success:
   a. supabase\migrations\20261026000001_phase3c_services_admin_coverage.sql   (skip if already run)
   b. supabase\migrations\20261027000001_phase4_payments_ledger_chat_quotes.sql
   If it prints a notice that pg_cron is unavailable: Database, Extensions, enable pg_cron, then run file (b) again. It is safe to run twice.
3. Terminal, in the project folder:  pnpm install   then   pnpm dev      Then Ctrl+Shift+R in the browser.

## What works right away (no keys needed)
Test-mode payments now write a real ledger. You can test: pay, provider steps with door code, confirm, payout (Finance page, "Complete test payouts"),
chat, cancel and refund, dispute outcomes, solar inspection then quote then three-stage job, provider Earnings, Providers admin (suspend and reinstate),
Services admin, and the Terms, Privacy and Safety pages.

## To see the Finance and Providers pages
Your admin account already has the admin role, which includes finance.

## What turns on when you add keys
Read supabase\functions\README.md. Paystack, Sendchamp or Termii, and Dojah each switch on their own part. Read docs\GO-LIVE-CHECKLIST.md before taking real money.
