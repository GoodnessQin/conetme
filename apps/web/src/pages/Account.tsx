import { useRef, useState } from "react";
import { normalizeNgPhone } from "@connectme/shared";
import { supabase } from "../lib/supabase";
import { messageFrom, uploadFile } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Avatar, Button, Card, Field, PageHeader, Switch, useToast } from "../components/ui";

export default function Account() {
  const { profile, session, refresh, signOut } = useAuth();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.full_name ?? "");
  const [cName, setCName] = useState(profile?.emergency_contact_name ?? "");
  const [cPhone, setCPhone] = useState(profile?.emergency_contact_phone?.replace("+234", "0") ?? "");
  const [sms, setSms] = useState(profile?.sms_alerts !== false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [up, setUp] = useState(false);

  async function save() {
    setErr("");
    if (name.trim().split(/\s+/).length < 2 || name.trim().length < 3) return setErr("Enter your first and last name.");
    const phone = cPhone.trim() ? normalizeNgPhone(cPhone) : null;
    if (cPhone.trim() && !phone) return setErr("Enter a valid Nigerian phone number for your trusted contact.");
    if ((cName.trim() && !phone) || (!cName.trim() && phone)) return setErr("Add both the name and the phone number of your trusted contact, or leave both empty.");
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), emergency_contact_name: cName.trim() || null, emergency_contact_phone: phone, sms_alerts: sms }).eq("id", session!.user.id);
    setBusy(false);
    if (error) return setErr(messageFrom(error));
    await refresh(); toast("Your details are saved.");
  }
  async function photo(f: File) {
    setUp(true); setErr("");
    try {
      const path = await uploadFile("avatars", session!.user.id, "avatar", f);
      const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", session!.user.id);
      if (error) throw error;
      await refresh(); toast("Photo updated.");
    } catch (e) { setErr(messageFrom(e)); } finally { setUp(false); }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="My account" subtitle="Your details, and someone you trust." />
      <Card>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={name || "You"} path={profile?.avatar_path} size={72} />
          <div>
            <input ref={file} type="file" accept="image/*" className="sr-only" aria-label="Profile photo" onChange={(e) => { const x = e.target.files?.[0]; if (x) photo(x); e.target.value = ""; }} />
            <Button variant="ghost" className="!w-auto !px-5 !py-2.5 !text-sm" loading={up} onClick={() => file.current?.click()}>{profile?.avatar_path ? "Change photo" : "Add photo"}</Button>
          </div>
        </div>
        <Field label="Full name" htmlFor="n" hint="Use the name on your ID. Providers see only your first name, after you pay."><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone number" htmlFor="p" hint="This is how you log in. To change it, contact support."><input id="p" className="input" disabled value={profile?.phone ? `+${profile.phone.replace(/^\+/, "")}` : ""} /></Field>
        <div className="mb-2 mt-6 flex items-center justify-between gap-4 rounded-2xl bg-surface p-3">
          <div><p className="font-bold">Text message alerts</p><p className="text-xs text-muted">Get a text when something needs you, such as a new request, an accepted offer or a payment. Texts never include names or addresses.</p></div>
          <Switch label="Text message alerts" checked={sms} onChange={setSms} />
        </div>
        <p className="mb-2 mt-6 font-bold">Trusted contact</p>
        <p className="mb-3 text-sm text-muted">When you book, you can send this person the provider’s name, the job address and the time with one tap.</p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="cn"><input id="cn" className="input" value={cName} onChange={(e) => setCName(e.target.value)} /></Field>
          <Field label="Phone number" htmlFor="cp"><input id="cp" className="input" inputMode="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} /></Field>
        </div>
        {err && <div className="mb-3"><Alert tone="danger">{err}</Alert></div>}
        <Button loading={busy} onClick={save}>Save changes</Button>
      </Card>
      <Button variant="ghost" className="mt-4" onClick={signOut}>Log out</Button>
    </div>
  );
}
