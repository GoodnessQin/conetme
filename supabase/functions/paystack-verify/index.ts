// Confirms a payment when the customer returns from Paystack. Webhooks do the same job in the background.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return json({ error: "not_configured" }, 501);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) return json({ error: "unauthorized" }, 401);
  const { reference } = await req.json().catch(() => ({ reference: "" }));
  if (!/^[A-Za-z0-9.=-]{8,80}$/.test(reference ?? "")) return json({ error: "bad_request" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: pay } = await admin.from("payments").select("id, status, customer_id, milestone_id").eq("reference", reference).maybeSingle();
  if (!pay || pay.customer_id !== u.user.id) return json({ error: "not_found" }, 404);
  const { data: m } = await admin.from("job_milestones").select("job_id").eq("id", pay.milestone_id).single();

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.status) return json({ status: "unknown", job_id: m?.job_id }, 200);
  const d = out.data;
  if (d.status === "success") {
    const { data: result } = await admin.rpc("apply_payment_success", { p_reference: reference, p_amount_kobo: d.amount, p_fee_kobo: d.fees ?? 0, p_raw: d });
    return json({ status: "success", result, job_id: m?.job_id });
  }
  if (d.status === "failed" || d.status === "abandoned") await admin.rpc("apply_payment_failure", { p_reference: reference, p_raw: d });
  return json({ status: d.status, job_id: m?.job_id });
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
