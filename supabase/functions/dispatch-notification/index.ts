// Texts people about things that need them, when the app is closed. Wire it to a Database Webhook on the notifications table (INSERT).
// Deploy with "Verify JWT" OFF and set WEBHOOK_SECRET. Messages never contain names, addresses or phone numbers.
import { createClient } from "npm:@supabase/supabase-js@2";

export function e164(phone: string): string { const d = phone.replace(/\D/g, ""); return d.startsWith("234") ? `+${d}` : d.startsWith("0") ? `+234${d.slice(1)}` : `+${d}`; }

/** Sends a text through the provider named in SMS_PROVIDER (sendchamp or termii). */
export async function sendSms(phone: string, text: string): Promise<"sent" | "failed" | "skipped"> {
  const provider = (Deno.env.get("SMS_PROVIDER") ?? "").toLowerCase();
  const to = e164(phone);
  try {
    if (provider === "sendchamp") {
      const key = Deno.env.get("SENDCHAMP_API_KEY");
      if (!key) return "skipped";
      const res = await fetch("https://api.sendchamp.com/api/v1/sms/send", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ to: [to], message: text, sender_name: Deno.env.get("SENDCHAMP_SENDER") ?? "ConnectMe", route: Deno.env.get("SENDCHAMP_ROUTE") ?? "dnd" }),
      });
      return res.ok ? "sent" : "failed";
    }
    if (provider === "termii") {
      const key = Deno.env.get("TERMII_API_KEY");
      if (!key) return "skipped";
      const res = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.replace(/^\+/, ""), from: Deno.env.get("TERMII_SENDER_ID") ?? "ConnectMe", sms: text, type: "plain", channel: Deno.env.get("TERMII_CHANNEL") ?? "dnd", api_key: key }),
      });
      return res.ok ? "sent" : "failed";
    }
  } catch { return "failed"; }
  return "skipped";
}

const naira = (kobo: unknown) => "₦" + Math.round(Number(kobo ?? 0) / 100).toLocaleString("en-NG");
const STATUS_TEXT: Record<string, string> = { on_the_way: "is on the way", arrived: "has arrived", working: "has started work", completed_by_provider: "has finished. Please confirm the work" };

export function smsFor(type: string, p: Record<string, unknown>): string | null {
  switch (type) {
    case "new_request": return `New ${p.service ?? "job"} request near you on ConnectMe. Open the app to send your offer.`;
    case "offer_received": return "You have a new offer on ConnectMe. Open the app to compare offers.";
    case "offer_accepted": return "A customer accepted your offer on ConnectMe. Open the app for next steps.";
    case "job_paid": return "Payment is held for your ConnectMe job. Open the app for the address and details.";
    case "job_update": return `Your ConnectMe provider ${STATUS_TEXT[String(p.status)] ?? "posted an update"}. Open the app.`;
    case "provider_approved": return "Good news: your ConnectMe application is approved. Switch on Available today to receive jobs.";
    case "provider_needs_info": return "Your ConnectMe application needs more information. Open the app to see what to update.";
    case "provider_rejected": return "Your ConnectMe application was not approved. Open the app for details.";
    case "provider_suspended": return "Your ConnectMe provider account has been suspended. Open the app for details.";
    case "payout_sent": return `Your ConnectMe payout of ${naira(p.net_kobo)} has been sent to your bank account.`;
    case "payment_released": return `The customer confirmed your job. ${naira(p.net_kobo)} is on its way to you.`;
    case "refund_sent": return `Your ConnectMe refund of ${naira(p.amount_kobo)} has been sent.`;
    case "quote_received": return "Your provider sent a quote on ConnectMe. Open the app to review it.";
    case "quote_accepted": return "A customer accepted your quote on ConnectMe. Open the app for next steps.";
    case "dispute_opened": return "A problem was reported on a ConnectMe job. Payment stays held while we review.";
    case "dispute_resolved": return "A reported problem on your ConnectMe job was resolved. Open the app for the decision.";
    case "job_cancelled": return "A ConnectMe job was cancelled. Open the app for details.";
    case "auto_confirmed": return "Your ConnectMe job was confirmed automatically and payment was released.";
    case "new_message": return "You have a new message about your ConnectMe job.";
    default: return null;
  }
}

export async function handler(req: Request): Promise<Response> {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => null);
  const rec = body?.record;
  if (!rec?.user_id || !rec?.type) return new Response("ok");
  const text = smsFor(rec.type, rec.payload ?? {});
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let result: "sent" | "failed" | "skipped" = "skipped";
  if (text) {
    const { data: prof } = await admin.from("profiles").select("phone, sms_alerts").eq("id", rec.user_id).maybeSingle();
    if (prof?.phone && prof.sms_alerts !== false) result = await sendSms(prof.phone, text);
  }
  await admin.from("notifications").update({ channel_results: { sms: result } }).eq("id", rec.id);
  return new Response(JSON.stringify({ sms: result }), { status: 200 });
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
