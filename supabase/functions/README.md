# Server functions

These run on Supabase, not in the browser. They hold the secret keys and do everything that moves money or calls an outside service.
The app works without them (test mode, manual checks, no texts). Add them one at a time as you get each key.

| Function | What it does | Needs |
|---|---|---|
| `send-sms-hook` | Sends the login code by SMS | Sendchamp or Termii key |
| `dispatch-notification` | Texts people about requests, offers, payments (app closed) | Sendchamp or Termii key |
| `paystack-init` | Starts the secure checkout | Paystack secret key |
| `paystack-verify` | Confirms the payment when the customer returns | Paystack secret key |
| `paystack-webhook` | Receives Paystack's payment and transfer events | Paystack secret key |
| `finance-runner` | Sends provider payouts and customer refunds | Paystack secret key |
| `resolve-bank` | Looks up the bank account name for providers | Paystack secret key |
| `kyc-identity` | NIN and selfie check | Dojah keys |

## Deploy each one (no command line needed)

1. Supabase, **Edge Functions**, **Deploy a new function**, **Via Editor**.
2. Name it exactly as in the table. Paste the whole contents of `supabase/functions/<name>/index.ts`. Deploy.
3. In the function's settings turn **Verify JWT** OFF. Each function checks who is calling by itself.
4. Add secrets once: **Edge Functions, Secrets**. Copy the names from `supabase/functions/.env.example`.

## Connect the pieces

- **Paystack webhook:** in Paystack, Settings, API Keys and Webhooks, set the webhook URL to
  `https://YOUR-PROJECT-REF.supabase.co/functions/v1/paystack-webhook`. Use your TEST keys until you go live.
- **Login codes:** Authentication, Hooks, **Send SMS**, choose HTTPS, URL `https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-sms-hook`,
  generate the secret and save it as `SEND_SMS_HOOK_SECRET`. Set `SMS_PROVIDER` to `sendchamp` or `termii`.
- **Text alerts:** Database, **Webhooks**, create one on table `notifications`, event Insert, type Supabase Edge Function `dispatch-notification`,
  and add the HTTP header `x-webhook-secret` with the value of `WEBHOOK_SECRET`.
- **Scheduled payouts:** the Finance page has a "Send due payouts now" button. To run it automatically, create a schedule (Integrations, Cron)
  that calls `finance-runner` every 5 minutes with the header `x-cron-secret: <CRON_SECRET>`.
  Automatic release after 48 hours, request expiry and unpaid-job clean-up run inside the database (pg_cron). Turn on the `pg_cron`
  extension under Database, Extensions, then run migration `20261027000001` again.

## Identity checks (Dojah)

Set `KYC_PROVIDER=dojah`, `DOJAH_SECRET_KEY`, `DOJAH_APP_ID`. For the sandbox set `DOJAH_BASE_URL=https://sandbox.dojah.io` and use the sandbox test NIN `70123456789`.
Automation can only pass a check or hand it to a human reviewer. It never rejects anyone.
The request format follows Dojah's published NIN with selfie endpoint. Confirm the response fields against your sandbox on first use.

## Tests

`CM_TEST=1 deno test -A supabase/functions/tests` runs 17 tests against simulated Paystack and Supabase responses.
They are not run by the app. They need Deno installed.
