// Supabase Auth "Send SMS" hook: delivers login codes through Sendchamp or Termii (SMS_PROVIDER).
// Deploy with "Verify JWT" OFF. Supabase signs the request (Standard Webhooks); we verify it.
import { Webhook } from "npm:standardwebhooks@1.0.0";

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

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const hookSecret = (Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
  const body = await req.text();
  let payload: { user: { phone: string }; sms: { otp: string } };
  try { payload = new Webhook(hookSecret).verify(body, Object.fromEntries(req.headers)) as typeof payload; }
  catch { return new Response(JSON.stringify({ error: { http_code: 401, message: "Invalid signature" } }), { status: 401 }); }

  const result = await sendSms(payload.user.phone, `Your ConnectMe code is ${payload.sms.otp}. Do not share it with anyone.`);
  if (result !== "sent") {
    return new Response(JSON.stringify({ error: { http_code: 500, message: "Could not send the code. Try again." } }), { status: 500 });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
