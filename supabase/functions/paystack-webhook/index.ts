// Receives Paystack events. Deploy with "Verify JWT" switched OFF: Paystack signs the request instead.
// A payment is trusted only if the signature is valid, the reference is new and the amount matches the database.
import { createClient } from "npm:@supabase/supabase-js@2";

export async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Approximate Paystack transfer fee in kobo. Confirm against your current rate card. */
export function transferFeeKobo(netKobo: number): number { return netKobo <= 500_000 ? 1_000 : netKobo <= 5_000_000 ? 2_500 : 5_000; }

export async function handler(req: Request): Promise<Response> {
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return new Response("not configured", { status: 501 });
  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") ?? "";
  if (!sig || !timingSafeEqual(sig, await hmacSha512Hex(secret, raw))) return new Response("invalid signature", { status: 401 });

  let ev: { event: string; data: Record<string, any> };
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const d = ev.data ?? {};
  const ref: string = String(d.reference ?? d.transfer_code ?? "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: isNew } = await admin.rpc("log_webhook", { p_provider: "paystack", p_event: ev.event, p_reference: ref, p_payload: ev });
  if (isNew === false) return new Response(JSON.stringify({ duplicate: true }), { status: 200 });

  let error: string | null = null;
  try {
    if (ev.event === "charge.success") {
      const { data: result } = await admin.rpc("apply_payment_success", { p_reference: d.reference, p_amount_kobo: d.amount, p_fee_kobo: d.fees ?? 0, p_raw: d });
      if (result === "amount_mismatch" || result === "unknown_reference") error = `charge.success ${result}`;
    } else if (ev.event === "transfer.success") {
      const { data: po } = await admin.from("payouts").select("id, net_kobo").eq("reference", d.reference).maybeSingle();
      if (po) await admin.rpc("mark_payout_sent", { p_payout: po.id, p_transfer_code: d.transfer_code ?? d.reference, p_fee: transferFeeKobo(po.net_kobo) });
      else error = "transfer.success for an unknown payout";
    } else if (ev.event === "transfer.failed" || ev.event === "transfer.reversed") {
      const { data: po } = await admin.from("payouts").select("id, status").eq("reference", d.reference).maybeSingle();
      if (po?.status === "sent") {
        await admin.from("audit_log").insert({ action: "transfer_reversed_after_sent", entity: "payouts", entity_id: po.id, after: d });
        error = "transfer reversed after it was marked sent: finance must review";
      } else if (po) await admin.rpc("mark_payout_failed", { p_payout: po.id, p_error: `${ev.event}: ${d.reason ?? ""}`, p_final: false });
    }
  } catch (e) { error = String(e instanceof Error ? e.message : e).slice(0, 300); }
  await admin.rpc("finish_webhook", { p_provider: "paystack", p_event: ev.event, p_reference: ref, p_error: error });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
