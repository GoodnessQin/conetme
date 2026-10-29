// Sends due provider payouts and customer refunds. Run it every few minutes from a schedule, or press the button on the Finance page.
// Authenticated by x-cron-secret (for schedules) or by a signed-in finance/admin user.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Approximate Paystack transfer fee in kobo. Confirm against your current rate card. */
export const transferFeeKobo = (net: number) => (net <= 500_000 ? 1_000 : net <= 5_000_000 ? 2_500 : 5_000);
export const normalizeBankName = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/\b(plc|ltd|limited|microfinance|mfb|nigeria|bank|of)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export function matchBankCode(name: string, banks: { name: string; code: string }[]): string | null {
  const n = normalizeBankName(name);
  const hit = banks.find((b) => normalizeBankName(b.name) === n) ?? banks.find((b) => { const x = normalizeBankName(b.name); return x && n && (x.includes(n) || n.includes(x)); });
  return hit?.code ?? null;
}

async function paystack(secret: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.paystack.co${path}`, { ...init, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok && out.status === true, out };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const cron = Deno.env.get("CRON_SECRET");
  let allowed = !!cron && req.headers.get("x-cron-secret") === cron;
  if (!allowed) {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: ok } = await userClient.rpc("finance_ok");
    allowed = ok === true;
  }
  if (!allowed) return json({ error: "forbidden" }, 403);

  const { data: setting } = await admin.from("settings").select("value").eq("key", "payment_mode").maybeSingle();
  const mode = String(setting?.value ?? "test").replace(/"/g, "");
  if (mode !== "paystack") return json({ skipped: "Payment mode is test. Use the test payout button." });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return json({ error: "not_configured" }, 501);

  const result = { payouts_sent: 0, payouts_pending: 0, payouts_failed: 0, refunds_sent: 0, refunds_failed: 0 };
  let bankList: { name: string; code: string }[] | null = null;

  const { data: payouts } = await admin.rpc("claim_payouts", { p_limit: 20 });
  for (const p of payouts ?? []) {
    try {
      if (!p.account_number || !p.account_name) throw new Error("No verified bank account on file");
      let code: string | null = p.bank_code;
      let recipient: string | null = p.recipient_code;
      if (!recipient) {
        if (!code) {
          if (!bankList) { const b = await paystack(secret, "/bank?country=nigeria&perPage=200&currency=NGN"); bankList = (b.out.data ?? []).map((x: any) => ({ name: x.name, code: x.code })); }
          code = matchBankCode(p.bank_name ?? "", bankList ?? []);
        }
        if (!code) throw new Error("Could not match the provider's bank");
        const r = await paystack(secret, "/transferrecipient", { method: "POST", body: JSON.stringify({ type: "nuban", name: p.account_name, account_number: p.account_number, bank_code: code, currency: "NGN" }) });
        if (!r.ok) throw new Error(r.out.message ?? "Could not create the transfer recipient");
        recipient = r.out.data.recipient_code;
        await admin.rpc("save_recipient_code", { p_provider: p.provider_id, p_bank_code: code, p_recipient: recipient });
      }
      const t = await paystack(secret, "/transfer", { method: "POST", body: JSON.stringify({ source: "balance", amount: p.net_kobo, recipient, reason: "ConnectMe payout", reference: p.reference }) });
      if (!t.ok) throw new Error(t.out.message ?? "Transfer was not accepted");
      const status = t.out.data?.status;
      if (status === "success") { await admin.rpc("mark_payout_sent", { p_payout: p.payout_id, p_transfer_code: t.out.data.transfer_code, p_fee: transferFeeKobo(p.net_kobo) }); result.payouts_sent++; }
      else if (status === "otp") { await admin.rpc("mark_payout_failed", { p_payout: p.payout_id, p_error: "Paystack needs an OTP to approve transfers. Turn off transfer OTP in Paystack settings.", p_final: false }); result.payouts_failed++; }
      else result.payouts_pending++; // accepted and processing: the transfer.success webhook completes it
    } catch (e) {
      await admin.rpc("mark_payout_failed", { p_payout: p.payout_id, p_error: String(e instanceof Error ? e.message : e), p_final: false });
      result.payouts_failed++;
    }
  }

  const { data: refunds } = await admin.rpc("claim_refunds", { p_limit: 20 });
  for (const r of refunds ?? []) {
    try {
      if (r.payment_provider === "test") { await admin.rpc("mark_refund_sent", { p_refund: r.refund_id, p_reference: "test" }); result.refunds_sent++; continue; }
      if (!r.payment_reference) throw new Error("No original payment to refund");
      const out = await paystack(secret, "/refund", { method: "POST", body: JSON.stringify({ transaction: r.payment_reference, amount: r.amount_kobo }) });
      if (!out.ok) throw new Error(out.out.message ?? "Refund was not accepted");
      await admin.rpc("mark_refund_sent", { p_refund: r.refund_id, p_reference: String(out.out.data?.id ?? "") });
      result.refunds_sent++;
    } catch (e) {
      await admin.rpc("mark_refund_failed", { p_refund: r.refund_id, p_error: String(e instanceof Error ? e.message : e) });
      result.refunds_failed++;
    }
  }
  return json(result);
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
