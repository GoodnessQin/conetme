import { useState } from "react";
import { normalizeNgPhone } from "@connectme/shared";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button } from "./ui";

/** For people who signed in with Google: add and confirm a phone number by text code. Providers need one for job alerts. */
export function PhoneAdd() {
  const { profile, refresh } = useAuth();
  const [phone, setPhone] = useState(""); const [sent, setSent] = useState<string | null>(null); const [code, setCode] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (profile?.phone) return null;
  async function send() {
    const p = normalizeNgPhone(phone);
    if (!p) return setErr("Enter a valid Nigerian phone number, for example 803 123 4567.");
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ phone: p });
    setBusy(false);
    if (error) return setErr(/already|registered/i.test(error.message) ? "That number is already used by another account." : "We could not send the code. Check the number and try again.");
    setSent(p);
  }
  async function confirm() {
    if (!sent) return;
    setBusy(true); setErr("");
    const { error } = await supabase.auth.verifyOtp({ phone: sent, token: code.trim(), type: "phone_change" });
    if (error) { setBusy(false); return setErr("That code is wrong or has expired. Check it or ask for a new one."); }
    await refresh(); setBusy(false);
  }
  return (
    <div className="mb-5"><Alert tone="warning" title="Add your phone number">
      <p className="mb-3">You signed in with Google. Providers need a confirmed phone number to receive job alerts and for support to reach you.</p>
      {!sent ? (
        <div className="flex gap-2"><span className="input w-auto select-none text-muted">+234</span><input aria-label="Phone number" className="input" inputMode="tel" placeholder="803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /><Button className="!w-auto !px-5" loading={busy} onClick={send}>Send code</Button></div>
      ) : (
        <div className="flex gap-2"><input aria-label="6-digit code" className="input text-center tracking-[.4em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /><Button className="!w-auto !px-5" loading={busy} onClick={confirm}>Confirm</Button></div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </Alert></div>
  );
}
