// Automated identity check for providers: NIN lookup plus selfie face match (Dojah).
// The NIN is used for this one call and stored only as a one-way code plus its last four digits.
// Automation can only pass a check or send it to a human. It never rejects anyone on its own.
// Set KYC_PROVIDER=dojah with DOJAH_SECRET_KEY and DOJAH_APP_ID. With anything else, checks stay manual.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ID_TYPES = ["nin_slip", "national_id", "drivers_licence", "voters_card", "passport"];

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
export function nameScore(a: string, b: string): number {
  const x = new Set(tokens(a)), y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let common = 0; for (const t of x) if (y.has(t)) common++;
  return common / Math.min(x.size, y.size);
}
const pick = (o: any, keys: string[]) => { for (const k of keys) if (o && o[k] != null && o[k] !== "") return String(o[k]); return ""; };

/** Reads the parts of Dojah's NIN + selfie response that we use. Field names are read defensively. */
export function parseDojah(out: any) {
  const e = out?.entity ?? {};
  const sv = e.selfie_verification ?? e.selfieVerification ?? {};
  const fullName = [pick(e, ["first_name", "firstname", "firstName"]), pick(e, ["middle_name", "middlename", "middleName"]), pick(e, ["last_name", "surname", "lastName"])].filter(Boolean).join(" ");
  const confidence = Number(sv.confidence_value ?? sv.confidence ?? NaN);
  return { found: Boolean(fullName), fullName, match: typeof sv.match === "boolean" ? (sv.match as boolean) : undefined, confidence: Number.isFinite(confidence) ? confidence : undefined };
}
export function evaluateFace(match: boolean | undefined, confidence: number | undefined): { status: "pass" | "review"; note: string } {
  if (match === true && (confidence ?? 0) >= 90) return { status: "pass", note: `Selfie matches the NIN photo (confidence ${confidence}).` };
  if (match === true) return { status: "review", note: `Possible match but confidence is ${confidence ?? "unknown"}. Reviewer to compare.` };
  return { status: "review", note: `The automated match was not confident${confidence != null ? ` (${confidence})` : ""}. Reviewer to compare the selfie with the ID photo.` };
}
export function evaluateNin(found: boolean, score: number): { status: "pass" | "review"; note: string } {
  if (!found) return { status: "review", note: "No name was returned for this NIN. Reviewer to check." };
  return score >= 0.66 ? { status: "pass", note: "NIN record found and the name matches the applicant." } : { status: "review", note: "NIN record found but the name differs from the applicant's name. Reviewer to confirm." };
}
export function toBase64(bytes: Uint8Array): string {
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) return json({ error: "unauthorized", message: "Sign in again to continue." }, 401);
  const { nin, id_type, selfie_path } = await req.json().catch(() => ({}));
  if (!/^\d{11}$/.test(nin ?? "")) return json({ error: "bad_request", message: "A National Identification Number has exactly 11 digits." }, 400);
  if (!ID_TYPES.includes(id_type)) return json({ error: "bad_request", message: "Choose the ID you are uploading." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const mode = (Deno.env.get("KYC_PROVIDER") ?? "manual").toLowerCase();
  const key = Deno.env.get("DOJAH_SECRET_KEY"), appId = Deno.env.get("DOJAH_APP_ID");

  if (mode !== "dojah" || !key || !appId || typeof selfie_path !== "string" || !selfie_path.startsWith(`${u.user.id}/`)) {
    const { error } = await admin.rpc("save_nin_for", { p_user: u.user.id, p_nin: nin, p_id_type: id_type, p_kyc_name: null });
    if (error) return json({ error: "cannot_save", message: error.message }, 400);
    return json({ mode: "manual" });
  }

  const { data: file } = await admin.storage.from("verification").download(selfie_path);
  if (!file) return json({ error: "no_selfie", message: "Upload your selfie first." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 3_000_000) return json({ error: "selfie_too_large", message: "That selfie is too large. Take a new one." }, 400);

  const base = Deno.env.get("DOJAH_BASE_URL") ?? "https://api.dojah.io";
  const res = await fetch(`${base}/api/v1/kyc/nin/verify`, {
    method: "POST", headers: { Authorization: key, AppId: appId, "Content-Type": "application/json" },
    body: JSON.stringify({ nin, selfie_image: toBase64(bytes) }),
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 400 || res.status === 422) return json({ error: "nin_not_found", message: "We could not find this NIN, or the selfie could not be read. Check the number and take a clear selfie." }, 422);
  if (!res.ok) {
    const { error } = await admin.rpc("save_nin_for", { p_user: u.user.id, p_nin: nin, p_id_type: id_type, p_kyc_name: null });
    if (error) return json({ error: "cannot_save", message: error.message }, 400);
    return json({ mode: "manual", note: "Automated check unavailable. A reviewer will check your identity." });
  }

  const parsed = parseDojah(out);
  const { data: prov } = await admin.from("providers").select("display_name").eq("user_id", u.user.id).maybeSingle();
  const { data: prof } = await admin.from("profiles").select("full_name").eq("id", u.user.id).maybeSingle();
  const score = Math.max(nameScore(parsed.fullName, prov?.display_name ?? ""), nameScore(parsed.fullName, prof?.full_name ?? ""));
  const ninEval = evaluateNin(parsed.found, score);
  const faceEval = evaluateFace(parsed.match, parsed.confidence);

  const { data: caseId, error } = await admin.rpc("save_nin_for", { p_user: u.user.id, p_nin: nin, p_id_type: id_type, p_kyc_name: parsed.fullName });
  if (error) return json({ error: "cannot_save", message: error.message }, 400);
  await admin.rpc("record_auto_check", { p_case: caseId, p_type: "nin", p_status: ninEval.status, p_score: Number(score.toFixed(4)), p_reference: "dojah", p_note: ninEval.note });
  await admin.rpc("record_auto_check", { p_case: caseId, p_type: "face_match", p_status: faceEval.status, p_score: parsed.confidence != null ? Number((parsed.confidence / 100).toFixed(4)) : null, p_reference: "dojah", p_note: faceEval.note });
  return json({ mode: "dojah", nin: ninEval.status, face: faceEval.status });
}

if (!Deno.env.get("CM_TEST")) Deno.serve(handler);
