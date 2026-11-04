# Your domain and updating the live app

## Use connectme.ng
Use **connectme.ng** as the main address. It matches the product name exactly and .ng tells customers you are a Nigerian business.
Do not use a misspelled name such as "conetme": people will mistype your name and land on someone else's site. If it is cheap, keep it only to redirect to connectme.ng.
Also check that the name "ConnectMe" is free to register with CAC and not already a trademark in the same field.

## Point connectme.ng at the app (Vercel)
1. Vercel, your project, **Settings, Domains**, add `connectme.ng` and `www.connectme.ng`. Vercel shows the exact DNS records to create.
2. At your domain registrar, DNS settings, create the records Vercel shows. Normally an **A** record for `@` and a **CNAME** for `www`. Use the exact values Vercel displays.
3. Wait. DNS can take from a few minutes up to a day. Vercel shows a green tick when it is ready and creates the secure (https) certificate itself.
4. In Vercel, set `connectme.ng` as the primary domain so `www` and the old `*.vercel.app` address redirect to it.

## Tell Supabase and Paystack the new address
- Supabase, Authentication, URL Configuration: Site URL `https://connectme.ng`. Add `https://connectme.ng` and `https://www.connectme.ng` to Redirect URLs.
- When Paystack is on: edit the secret `APP_URL` to `https://connectme.ng`.
- Set `PAYMENT_EMAIL_DOMAIN` to `pay.connectme.ng` (it only builds placeholder customer emails, nothing is sent to it).

## Business email
Create `support@connectme.ng` (your registrar's email service, Zoho Mail or Google Workspace). Put it in the Terms and Privacy pages and on the app as the support contact.

## Putting changes live
Copy new files over your project, then in the project folder:

    git add .
    git commit -m "Update"
    git push

Vercel builds and publishes by itself in about a minute. Run any new SQL file in Supabase first when an update includes one.
