// Looks up the account name from Paystack, so providers cannot type a name that is not on the account.
// Stores the verified details server-side and compares the account name with the ID name (bank_match check).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const normalizeBankName = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/\b(plc|ltd|limited|microfinance|mfb|nigeria|bank|of)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function matchBank(name: string, banks: { name: string; code: string }[]) {
  const n = normalizeBankName(name);
  if (!n) return null;
  return banks.find((b) => normalizeBankName(b.name) === n) ?? banks.find((b) => { const x = normalizeBankName(b.name); return x && (x.includes(n) || n.includes(x)); }) ?? null;
}

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
/** 0..1: share of name words that appear in both names. Order and initials do not matter. */
export function nameScore(a: string, b: string): number {
  const x = new Set(tokens(a)), y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let common = 0; for (const t of x) if (y.has(t)) common++;
  return common / Math.min(x.size, y.size);
}

let cache: { at: number; banks: { name: string; code: string }[] } | null = null;
async function banks(secret: string) {
  if (cache && Date.now() - cache.at < 6 * 3600_000) return cache.banks;
  const res = await fetch("https://api.paystack.co/bank?country=nigeria&perPage=200&currency=NGN", { headers: { Authorization: `Bearer ${secret}` } });
  const out = await res.json();
  cache = { at: Date.now(), banks: (out.data ?? []).map((b: any) => ({ name: b.name, code: b.code })) };
  return cache.banks;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return json({ error: "not_configured" }, 501);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) return json({ error: "unauthorized" }, 401);
  const { bank_name, account_number } = await req.json().catch(() => ({}));
  if (!/^\d{10}$/.test(account_number ?? "")) return json({ error: "bad_request", message: "A Nigerian bank account number has exactly 10 digits." }, 400);

  const bank = matchBank(String(bank_name ?? ""), await banks(secret));
  if (!bank) return json({ error: "unknown_bank", message: "We could not match that bank. Choose it again." }, 400);
  const res = await fetch(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank.code}`, { headers: { Authorization: `Bearer ${secret}` } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.status) return json({ error: "not_found", message: "We could not find that account. Check the bank and the number." }, 404);
  const accountName: string = out.data.account_name;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: caseId, error } = await admin.rpc("save_bank_for", { p_user: u.user.id, p_bank: bank_name, p_bank_code: bank.code, p_number: account_number, p_account_name: accountName });
  if (error) return json({ error: "cannot_save", message: error.message }, 400);

  const { data: prov } = await admin.from("providers").select("id").eq("user_id", u.user.id).maybeSingle();
  const { data: priv } = prov ? await admin.from("provider_private").select("kyc_full_name").eq("provider_id", prov.id).maybeSingle() : { data: null };
  let match: "pass" | "review" | "manual" = "manual";
  if (priv?.kyc_full_name) {
    const score = nameScore(accountName, priv.kyc_full_name);
    match = score >= 0.66 ? "pass" : "review";
    await admin.rpc("record_auto_check", { p_case: caseId, p_type: "bank_match", p_status: match, p_score: Number(score.toFixed(4)), p_reference: "paystack-resolve", p_note: match === "pass" ? "Account name matches the name on the ID." : "Account name differs from the ID name. Reviewer to confirm." });
  }
  return json({ account_name: accountName, bank_code: bank.code, bank_name, match });
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
