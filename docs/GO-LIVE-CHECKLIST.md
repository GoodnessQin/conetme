# Go-live checklist

Do not take real customer money until every box is ticked.

## Legal and money
- [ ] A Nigerian fintech lawyer has confirmed in writing how customer funds are held for the pilot.
- [ ] The Terms, Privacy Notice and Safety Code (draft text is in the app) are reviewed and finalised by a lawyer.
- [ ] The business is registered (CAC) and the Paystack business account is approved for live keys.
- [ ] A dedicated client-funds bank account exists, separate from operating money.
- [ ] Paystack confirmed in writing: how funds are held before transfers, transfer limits, whether transfer OTP can be turned off for API transfers.
- [ ] A data-protection registration and a named data protection contact are in place.

## Technical
- [ ] All server functions are deployed with secrets set, Verify JWT off, webhooks wired.
- [ ] Test-mode flow completed end to end with Paystack TEST keys: pay, confirm, payout, cancel, refund, dispute.
- [ ] Finance page shows "Books balance" after every test run.
- [ ] Remove Supabase test phone numbers and the shared test code. Real SMS login works for a new number.
- [ ] Turn off test payments and switch to live:
      update settings set value = 'false' where key = 'test_payments';
      update settings set value = '"paystack"' where key = 'payment_mode';
- [ ] Give finance staff the finance role (not the same person as the one who approves large payouts):
      insert into user_roles (user_id, role) select id, 'finance' from profiles where phone like '%XXXXXXXXXX';
- [ ] Set a payout delay if you want a chargeback buffer: update settings set value = '24' where key = 'payout_delay_hours';
- [ ] Backups are on and a restore has been tested. Error monitoring is on.
- [ ] 20 verified providers recruited in the first area before customers are invited.

## People
- [ ] Support contact published in the app. A named person decides disputes within 24 hours.
- [ ] Verifier staff trained on the 8 checks and how to call guarantors and references.
