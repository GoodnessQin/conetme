// Starts a Paystack checkout for the customer's next unpaid milestone.
// The amount comes from the database (start_payment), never from the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function payerEmail(profileEmail: string | null | undefined, userId: string, domain: string): string {
  if (profileEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profileEmail)) return profileEmail;
  return `u${userId.replace(/-/g, "").slice(0, 16)}@${domain}`;
}

export function buildInitBody(p: { reference: string; amountKobo: number; email: string; callbackUrl: string; jobId: string; paymentId: string; label: string }) {
  return {
    email: p.email, amount: p.amountKobo, reference: p.reference, currency: "NGN", callback_url: p.callbackUrl,
    metadata: { job_id: p.jobId, payment_id: p.paymentId, milestone: p.label, custom_fields: [{ display_name: "Payment for", variable_name: "milestone", value: p.label }] },
  };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (!secret || !appUrl) return json({ error: "not_configured", message: "Online payment is not switched on yet." }, 501);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) return json({ error: "unauthorized", message: "Sign in again to continue." }, 401);

  const body = await req.json().catch(() => ({}));
  if (!UUID.test(body.job_id ?? "")) return json({ error: "bad_request", message: "Missing job." }, 400);

  const { data: pay, error } = await userClient.rpc("start_payment", { p_job: body.job_id });
  if (error) return json({ error: "cannot_start", message: error.message }, 400);

  const { data: prof } = await userClient.from("profiles").select("email").eq("id", u.user.id).maybeSingle();
  const email = payerEmail(prof?.email, u.user.id, Deno.env.get("PAYMENT_EMAIL_DOMAIN") ?? "pay.connectme.ng");
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildInitBody({ reference: pay.reference, amountKobo: pay.amount_kobo, email, callbackUrl: `${appUrl}/payments/return?job=${pay.job_id}&ref=${pay.reference}`, jobId: pay.job_id, paymentId: pay.payment_id, label: pay.label })),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.status) return json({ error: "provider_error", message: "The payment provider could not start the checkout. Try again." }, 502);
  return json({ authorization_url: out.data.authorization_url, reference: pay.reference });
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
