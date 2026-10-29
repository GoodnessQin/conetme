import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ADDRESS_DOC_TYPES, ID_TYPES, NIGERIAN_BANKS } from "@connectme/shared";
import { supabase } from "../../lib/supabase";
import { FunctionUnavailable, invokeFn, messageFrom, publicUrl, rpc, uploadFile } from "../../lib/api";
import { useAuth } from "../../auth/AuthProvider";
import { useAreas, useMyProvider, useServices } from "../../lib/queries";
import type { Progress } from "../../lib/types";
import { DocUploader } from "../../components/DocUploader";
import { Alert, Avatar, Button, Card, Field, ListSkeleton, PageHeader, ProgressBar, useToast } from "../../components/ui";

const STEPS = [
  { id: "profile", title: "Your profile", done: (p: Progress) => !!p.profile },
  { id: "services", title: "Services and prices", done: (p: Progress) => (p.services ?? 0) > 0 },
  { id: "identity", title: "Identity", done: (p: Progress) => !!p.nin && !!p.id_photo && !!p.selfie },
  { id: "bank", title: "Bank account", done: (p: Progress) => !!p.bank },
  { id: "guarantor", title: "Guarantor", done: (p: Progress) => !!p.guarantor },
  { id: "address", title: "Proof of address", done: (p: Progress) => !!p.address_doc },
  { id: "credentials", title: "Work credentials", done: (p: Progress) => (p.credentials ?? 0) > 0 },
  { id: "work", title: "Past work and references", done: (p: Progress) => (p.portfolio ?? 0) >= 3 && (p.references ?? 0) >= 2 },
  { id: "review", title: "Review and submit", done: () => false },
];

function StepFrame({ title, intro, children, onSave, saving, error, last, onBack, saveLabel = "Save and continue" }: {
  title: string; intro: ReactNode; children: ReactNode; onSave: () => void; saving?: boolean; error?: string; last?: boolean; onBack?: () => void; saveLabel?: string;
}) {
  return (
    <Card>
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      <div className="mb-5 mt-1 text-sm text-muted">{intro}</div>
      {children}
      {error && <div className="mb-4"><Alert tone="danger" title="Could not save">{error}</Alert></div>}
      <div className="mt-2 flex gap-3">
        {onBack && <Button variant="ghost" onClick={onBack} className="sm:max-w-[140px]">Back</Button>}
        <Button loading={saving} onClick={onSave}>{last ? "Submit application" : saveLabel}</Button>
      </div>
    </Card>
  );
}

export default function Register() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { session } = useAuth();
  const prog = useQuery({ queryKey: ["progress"], queryFn: () => rpc<Progress>("my_verification_progress") });
  const p = prog.data;
  const idx = Math.min(Math.max(Number(sp.get("step") ?? 1) - 1, 0), STEPS.length - 1);
  const go = (i: number) => { setSp({ step: String(i + 1) }); window.scrollTo({ top: 0 }); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["progress"] });

  // Every upload needs a case to belong to. Create it as soon as the provider profile exists.
  const caseQ = useQuery({ queryKey: ["case", p?.has_provider], enabled: !!p?.has_provider, queryFn: () => rpc<string>("ensure_verification_case") });

  if (prog.isLoading) return <ListSkeleton />;
  if (p?.has_provider && p.status && !["draft", "needs_info"].includes(p.status)) return <Navigate to="/provider" replace />;
  const doneCount = p ? STEPS.slice(0, 8).filter((s) => s.done(p)).length : 0;
  const step = STEPS[idx]!;
  const next = () => { refresh(); go(Math.min(idx + 1, STEPS.length - 1)); };
  const back = idx > 0 ? () => go(idx - 1) : undefined;
  const shared = { p: p ?? ({ has_provider: false } as Progress), caseId: caseQ.data ?? null, next, back, refresh };

  return (
    <>
      <PageHeader back={{ to: "/provider", label: "Dashboard" }} title="Provider application"
        subtitle="Customers let you into their homes, so every provider is checked before they can bid. Your progress saves after each step." />
      {p?.status === "needs_info" && p.decision_note && <div className="mb-5"><Alert tone="warning" title="Our team needs more from you">{p.decision_note}</Alert></div>}
      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <aside>
          <div className="mb-3"><ProgressBar value={(doneCount / 8) * 100} label="Application progress" /><p className="mt-1 text-xs font-semibold text-muted">{doneCount} of 8 sections complete</p></div>
          <ol className="hidden space-y-1 md:block">
            {STEPS.map((s, i) => {
              const done = p ? s.done(p) : false;
              return (
                <li key={s.id}><button onClick={() => go(i)} aria-current={i === idx ? "step" : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${i === idx ? "bg-brand-50 text-brand" : "text-ink hover:bg-surface"}`}>
                  <span className={`grid h-6 w-6 flex-none place-items-center rounded-full text-xs ${done ? "bg-success text-white" : i === idx ? "bg-brand text-white" : "bg-line text-muted"}`}>{done ? "✓" : i + 1}</span>{s.title}</button></li>
              );
            })}
          </ol>
          <p className="text-sm font-bold md:hidden">Step {idx + 1} of {STEPS.length}: {step.title}</p>
        </aside>
        <div>
          {step.id === "profile" && <ProfileStep {...shared} userId={session!.user.id} />}
          {step.id !== "profile" && !p?.has_provider && <Alert title="Start with your profile">Complete the first step so we can create your provider profile.</Alert>}
          {p?.has_provider && step.id === "services" && <ServicesStep {...shared} />}
          {p?.has_provider && step.id === "identity" && <IdentityStep {...shared} />}
          {p?.has_provider && step.id === "bank" && <BankStep {...shared} />}
          {p?.has_provider && step.id === "guarantor" && <GuarantorStep {...shared} />}
          {p?.has_provider && step.id === "address" && <AddressStep {...shared} />}
          {p?.has_provider && step.id === "credentials" && <CredentialsStep {...shared} />}
          {p?.has_provider && step.id === "work" && <WorkStep {...shared} userId={session!.user.id} />}
          {p?.has_provider && step.id === "review" && <ReviewStep {...shared} goTo={go} onDone={() => nav("/provider")} />}
        </div>
      </div>
    </>
  );
}

interface StepProps { p: Progress; caseId: string | null; next: () => void; back?: () => void; refresh: () => void }

/* ---------- 1. Profile ---------- */
function ProfileStep({ p, next, userId, refresh }: StepProps & { userId: string }) {
  const { profile, refresh: refreshAuth } = useAuth();
  const prov = useMyProvider();
  const areas = useAreas().data ?? [];
  const [f, setF] = useState({ name: "", years: "", area: "", radius: "10", bio: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [up, setUp] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || prov.isLoading) return;
    loaded.current = true;
    const d = prov.data;
    setF({ name: d?.display_name ?? profile?.full_name ?? "", years: d?.years_experience != null ? String(d.years_experience) : "", area: d?.base_area_id ?? "", radius: String(d?.radius_km ?? 10), bio: d?.bio ?? "" });
    setPhoto(profile?.avatar_path ?? null);
  }, [prov.isLoading, prov.data, profile]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function uploadPhoto(fl: File) {
    setUp(true); setErr("");
    try {
      const path = await uploadFile("avatars", userId, "avatar", fl);
      const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", userId);
      if (error) throw error;
      setPhoto(path); refreshAuth();
    } catch (e) { setErr(messageFrom(e)); } finally { setUp(false); }
  }
  async function save() {
    if (!photo) return setErr("Add a clear profile photo of your face. Customers see it before you arrive.");
    if (f.name.trim().length < 3) return setErr("Enter the name customers will see.");
    if (!f.area) return setErr("Choose the area you work from.");
    if (f.years === "" || Number(f.years) < 0 || Number(f.years) > 60) return setErr("Enter your years of experience as a number between 0 and 60.");
    if (f.bio.trim().length < 20) return setErr("Write at least 20 characters about your experience so customers can trust your offers.");
    setBusy(true); setErr("");
    const row = { display_name: f.name.trim(), bio: f.bio.trim(), years_experience: Number(f.years), base_area_id: f.area, radius_km: Math.min(30, Math.max(1, Number(f.radius) || 10)) };
    const { error } = prov.data ? await supabase.from("providers").update(row).eq("id", prov.data.id) : await supabase.from("providers").insert({ ...row, user_id: userId });
    setBusy(false);
    if (error) return setErr(messageFrom(error));
    await prov.refetch(); refresh(); next();
  }
  return (
    <StepFrame title="Your profile" intro="This is what customers see when they compare offers. Use your real face and name." onSave={save} saving={busy} error={err}>
      <div className="mb-5 flex items-center gap-4">
        <Avatar name={f.name || "You"} path={photo} size={72} />
        <div>
          <input ref={file} type="file" accept="image/*" capture="user" className="sr-only" aria-label="Profile photo" onChange={(e) => { const x = e.target.files?.[0]; if (x) uploadPhoto(x); e.target.value = ""; }} />
          <Button variant="ghost" className="!w-auto !px-5 !py-2.5 !text-sm" loading={up} onClick={() => file.current?.click()}>{photo ? "Change photo" : "Add profile photo"}</Button>
          <p className="mt-1 text-xs text-muted">Face clearly visible, no sunglasses, no group photos.</p>
        </div>
      </div>
      <Field label="Name customers will see" htmlFor="pn"><input id="pn" className="input" value={f.name} onChange={set("name")} /></Field>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Years of experience" htmlFor="py"><input id="py" className="input" inputMode="numeric" value={f.years} onChange={(e) => setF({ ...f, years: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Area you work from" htmlFor="pa">
          <select id="pa" className="input" value={f.area} onChange={set("area")}><option value="">Select…</option>
            {["Lagos", "Abuja"].map((c) => <optgroup key={c} label={c}>{areas.filter((a) => a.city === c).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}</select>
        </Field>
      </div>
      <Field label="How far will you travel? (km)" htmlFor="pr" hint="Requests from beyond this distance are not sent to you. Maximum 30 km."><input id="pr" className="input" inputMode="numeric" value={f.radius} onChange={(e) => setF({ ...f, radius: e.target.value.replace(/\D/g, "") })} /></Field>
      <Field label="About your work" htmlFor="pb" hint="Mention the kinds of jobs you do best, certifications and how you work. No phone numbers or links."><textarea id="pb" rows={4} className="input" value={f.bio} onChange={set("bio")} /></Field>
    </StepFrame>
  );
}

/* ---------- 2. Services ---------- */
function ServicesStep({ next, back, refresh }: StepProps) {
  const { data: services = [] } = useServices();
  const prov = useMyProvider();
  const existing = useQuery({ queryKey: ["my-services", prov.data?.id], enabled: !!prov.data, queryFn: async () => {
    const { data } = await supabase.from("provider_services").select("service_id, typical_price_kobo").eq("provider_id", prov.data!.id);
    return (data ?? []) as { service_id: string; typical_price_kobo: number | null }[];
  } });
  const [sel, setSel] = useState<Record<string, string>>({});
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  useEffect(() => { if (existing.data && !loaded.current) { loaded.current = true; setSel(Object.fromEntries(existing.data.map((r) => [r.service_id, r.typical_price_kobo ? String(r.typical_price_kobo / 100) : ""]))); } }, [existing.data]);
  async function save() {
    const ids = Object.keys(sel);
    if (!ids.length) return setErr("Choose at least one service.");
    for (const id of ids) if (!(Number(sel[id]) >= 500)) return setErr("Enter a typical starting price of at least ₦500 for each service you chose.");
    setBusy(true); setErr("");
    const pid = prov.data!.id;
    const removed = (existing.data ?? []).filter((r) => !ids.includes(r.service_id)).map((r) => r.service_id);
    if (removed.length) await supabase.from("provider_services").delete().eq("provider_id", pid).in("service_id", removed);
    const { error } = await supabase.from("provider_services").upsert(ids.map((id) => ({ provider_id: pid, service_id: id, typical_price_kobo: Math.round(Number(sel[id]) * 100) })), { onConflict: "provider_id,service_id" });
    setBusy(false);
    if (error) return setErr(messageFrom(error));
    await existing.refetch(); refresh(); next();
  }
  return (
    <StepFrame title="Services and prices" intro="Choose what you offer. The price is a typical starting point that customers see on your profile. You set the real price on each offer." onSave={save} saving={busy} error={err} onBack={back}>
      <div className="space-y-3">
        {services.map((s) => {
          const on = s.id in sel;
          return (
            <div key={s.id} className={`rounded-2xl border p-4 ${on ? "border-brand bg-brand-50" : "border-line"}`}>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-brand" checked={on} onChange={() => setSel((c) => { const n = { ...c }; if (on) delete n[s.id]; else n[s.id] = ""; return n; })} />
                <span><b>{s.name}</b><br /><span className="text-sm text-muted">{s.description}</span></span>
              </label>
              {on && (
                <div className="mt-3 sm:ml-8">
                  <label htmlFor={`pp-${s.id}`} className="text-sm font-semibold">{s.pricing_mode === "quote" ? "Typical site inspection fee (₦)" : "Typical starting price (₦)"}</label>
                  <input id={`pp-${s.id}`} className="input mt-1 max-w-xs" inputMode="numeric" value={sel[s.id]} onChange={(e) => setSel({ ...sel, [s.id]: e.target.value.replace(/\D/g, "") })} />
                  {s.pricing_mode === "quote" && <p className="mt-1 text-xs text-muted">Solar jobs begin with a paid site inspection. After the visit you send a full quote paid in three stages.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </StepFrame>
  );
}

/* ---------- 3. Identity ---------- */
function IdentityStep({ p, caseId, next, back, refresh }: StepProps) {
  const toast = useToast();
  const [idType, setIdType] = useState<string>(ID_TYPES[0].value);
  const [nin, setNin] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setErr("");
    if (!p.nin || nin) {
      if (!/^\d{11}$/.test(nin)) return setErr("Your National Identification Number (NIN) has exactly 11 digits.");
    }
    if (!p.id_photo) return setErr("Upload a clear photo of your ID.");
    if (!p.selfie) return setErr("Take a selfie so we can match your face to your ID.");
    setBusy(true);
    try {
      if (nin) {
        const { data: selfie } = await supabase.from("verification_documents").select("storage_path").eq("case_id", caseId!).eq("type", "selfie").order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
        try {
          const r = await invokeFn<{ mode: string; nin?: string; face?: string }>("kyc-identity", { nin, id_type: idType, selfie_path: selfie?.storage_path });
          if (r.mode === "dojah") toast(r.nin === "pass" && r.face === "pass" ? "Identity checked: your selfie matches your ID." : "Saved. A reviewer will compare your selfie with your ID.");
        } catch (e) {
          if (e instanceof FunctionUnavailable) await rpc("save_nin", { p_nin: nin, p_id_type: idType }); else throw e;
        }
      }
      setNin(""); refresh(); next();
    } catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); }
  }
  return (
    <StepFrame title="Identity" intro="We confirm you are the person on your ID. Our reviewers compare your selfie with the photo on your ID." onSave={save} saving={busy} error={err} onBack={back}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="ID you will upload" htmlFor="idt"><select id="idt" className="input" value={idType} onChange={(e) => setIdType(e.target.value)}>{ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        <Field label="National Identification Number (NIN)" htmlFor="nin" hint={p.nin ? `Saved: ending ${p.nin_last4}. Enter a new number only to replace it.` : "11 digits. Dial *346# on your registered line if you do not know it."}>
          <input id="nin" className="input" inputMode="numeric" maxLength={11} autoComplete="off" value={nin} onChange={(e) => setNin(e.target.value.replace(/\D/g, ""))} placeholder={p.nin ? "•••••••" + p.nin_last4 : "12345678901"} />
        </Field>
      </div>
      <div className="mb-4"><Alert title="How we handle your NIN">We keep only a one-way code and the last four digits. Your full NIN is never stored in readable form, and it is never shown to customers.</Alert></div>
      {caseId ? (
        <>
          <DocUploader caseId={caseId} type="id_photo" max={2} label="Photo of your ID" hint="Front of the card or slip. All four corners and the photo must be visible and readable." />
          <DocUploader caseId={caseId} type="selfie" max={1} capture="user" accept="image/*" label="Selfie" hint="Face the camera in good light, no sunglasses, cap or mask. This must clearly be the person on the ID." />
        </>
      ) : <ListSkeleton rows={2} />}
    </StepFrame>
  );
}

/* ---------- 4. Bank ---------- */
function BankStep({ p, next, back, refresh }: StepProps) {
  const toast = useToast();
  const [bank, setBank] = useState<string>(p.bank_name ?? ""); const [num, setNum] = useState(""); const [name, setName] = useState("");
  const [manual, setManual] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setErr("");
    if (p.bank && !num && !name) return next();
    if (!bank) return setErr("Choose your bank.");
    if (!/^\d{10}$/.test(num)) return setErr("A Nigerian bank account number has exactly 10 digits.");
    setBusy(true);
    try {
      if (!manual) {
        try {
          const r = await invokeFn<{ account_name: string; match: string }>("resolve-bank", { bank_name: bank, account_number: num });
          setNum(""); refresh(); toast(`Account verified: ${r.account_name}`); next(); return;
        } catch (e) {
          if (!(e instanceof FunctionUnavailable)) throw e;
          setManual(true); setErr("Automatic account lookup is not available yet. Enter the account name exactly as your bank shows it, then continue."); return;
        }
      }
      if (name.trim().length < 3) return setErr("Enter the account name exactly as your bank shows it.");
      await rpc("save_bank", { p_bank: bank, p_number: num, p_account_name: name });
      refresh(); next();
    } catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); }
  }
  return (
    <StepFrame title="Bank account" intro="This is where your earnings are paid. The account name must match the name on your ID. Payouts to any other name are not allowed." onSave={save} saving={busy} error={err} onBack={back}>
      {p.bank && <div className="mb-4"><Alert tone="success" title="Account saved">{p.bank_name}, ending {p.bank_last4}. Fill the fields below only to replace it.</Alert></div>}
      <Field label="Bank" htmlFor="bk"><select id="bk" className="input" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Select…</option>{NIGERIAN_BANKS.map((b) => <option key={b}>{b}</option>)}</select></Field>
      <Field label="Account number" htmlFor="an" hint={manual ? undefined : "We look up the account name from your bank, so you do not need to type it."}><input id="an" className="input" inputMode="numeric" maxLength={10} value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} /></Field>
      {manual && <Field label="Account name" htmlFor="ac" hint="As it appears in your banking app."><input id="ac" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>}
    </StepFrame>
  );
}

/* ---------- 5. Guarantor ---------- */
function GuarantorStep({ next, back, refresh }: StepProps) {
  const g = useQuery({ queryKey: ["guarantor"], queryFn: async () => (await supabase.from("guarantors").select("name,phone,relationship,address,years_known").maybeSingle()).data });
  const [f, setF] = useState({ name: "", phone: "", rel: "", address: "", years: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  useEffect(() => { if (g.data && !loaded.current) { loaded.current = true; setF({ name: g.data.name, phone: g.data.phone.replace("+234", "0"), rel: g.data.relationship, address: g.data.address ?? "", years: g.data.years_known != null ? String(g.data.years_known) : "" }); } }, [g.data]);
  async function save() {
    setErr("");
    if (f.name.trim().length < 5) return setErr("Enter your guarantor’s full name.");
    if (!f.phone.trim()) return setErr("Enter your guarantor’s phone number.");
    if (!f.rel) return setErr("Say how you know your guarantor.");
    if (f.address.trim().length < 10) return setErr("Enter your guarantor’s home or work address.");
    if (f.years === "" || Number(f.years) < 1) return setErr("Enter how many years they have known you (at least 1).");
    setBusy(true);
    try { await rpc("save_guarantor", { p_name: f.name, p_phone: f.phone, p_relationship: f.rel, p_address: f.address, p_years: Number(f.years) }); await g.refetch(); refresh(); next(); }
    catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); }
  }
  return (
    <StepFrame title="Guarantor" intro="A guarantor is a responsible adult who knows you and vouches for you. Our team calls them to confirm. Choose someone who will pick up." onSave={save} saving={busy} error={err} onBack={back}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="gn"><input id="gn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone number" htmlFor="gp" hint="Must be different from your own."><input id="gp" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="How do you know them?" htmlFor="gr"><select id="gr" className="input" value={f.rel} onChange={(e) => setF({ ...f, rel: e.target.value })}><option value="">Select…</option>{["Family member", "Employer or client", "Landlord", "Community or religious leader", "Colleague", "Friend"].map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Years they have known you" htmlFor="gy"><input id="gy" className="input" inputMode="numeric" value={f.years} onChange={(e) => setF({ ...f, years: e.target.value.replace(/\D/g, "") })} /></Field>
      </div>
      <Field label="Their home or work address" htmlFor="ga"><textarea id="ga" rows={2} className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
    </StepFrame>
  );
}

/* ---------- 6. Address ---------- */
function AddressStep({ p, caseId, next, back }: StepProps) {
  const [err, setErr] = useState("");
  return (
    <StepFrame title="Proof of address" intro="Customers trust providers who can be found. Upload one document that shows where you live." onSave={() => (p.address_doc ? next() : setErr("Upload a proof of address to continue."))} error={err} onBack={back}>
      <p className="mb-2 text-sm font-semibold">Accepted documents</p>
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-muted">{ADDRESS_DOC_TYPES.map((d) => <li key={d}>{d}</li>)}</ul>
      <p className="mb-4 text-sm text-muted">The document must be less than three months old and show your name, or be signed by your estate or community head.</p>
      {caseId && <DocUploader caseId={caseId} type="address_proof" max={2} label="Proof of address" />}
    </StepFrame>
  );
}

/* ---------- 7. Credentials ---------- */
function CredentialsStep({ p, caseId, next, back }: StepProps) {
  const prov = useMyProvider();
  const catalog = useServices().data ?? [];
  const mine = useQuery({ queryKey: ["my-service-names", prov.data?.id], enabled: !!prov.data, queryFn: async () => {
    const { data } = await supabase.from("provider_services").select("services(name,slug)").eq("provider_id", prov.data!.id);
    return ((data ?? []) as unknown as { services: { name: string; slug: string } }[]).map((r) => r.services);
  } });
  const [err, setErr] = useState("");
  return (
    <StepFrame title="Work credentials" intro="Show us that you are qualified for the work you chose. Upload every document that applies." onSave={() => ((p.credentials ?? 0) > 0 ? next() : setErr("Upload at least one credential to continue."))} error={err} onBack={back}>
      {mine.data?.map((s) => {
        const req = catalog.find((c) => c.slug === s.slug)?.credential_requirements;
        return req ? (
          <div key={s.slug} className="mb-5 rounded-2xl bg-surface p-4">
            <p className="font-bold">{s.name}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{req.items.map((i: string) => <li key={i}>{i}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">{req.note}</p>
          </div>
        ) : null;
      })}
      {caseId && <DocUploader caseId={caseId} type="credential" max={8} label="Credential documents and photos" hint="Certificates, permits, registration documents or photos. Up to 8 files." />}
    </StepFrame>
  );
}

/* ---------- 8. Work and references ---------- */
function WorkStep({ p, next, back, refresh, userId }: StepProps & { userId: string }) {
  const qc = useQueryClient();
  const prov = useMyProvider();
  const services = useServices().data ?? [];
  const work = useQuery({ queryKey: ["portfolio", prov.data?.id], enabled: !!prov.data, queryFn: async () => (await supabase.from("portfolio_items").select("id,photo_path,caption").eq("provider_id", prov.data!.id).order("created_at")).data ?? [] });
  const refs = useQuery({ queryKey: ["refs"], queryFn: async () => (await supabase.from("provider_references").select("name,phone,relationship").order("created_at")).data ?? [] });
  const [caption, setCaption] = useState(""); const [up, setUp] = useState(false); const [prog, setProg] = useState("");
  const [r, setR] = useState([{ name: "", phone: "", relationship: "" }, { name: "", phone: "", relationship: "" }]);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  useEffect(() => { if (refs.data?.length && !loaded.current) { loaded.current = true; setR(refs.data.map((x) => ({ ...x, phone: x.phone.replace("+234", "0") })).concat([{ name: "", phone: "", relationship: "" }]).slice(0, Math.max(2, refs.data.length))); } }, [refs.data]);

  async function addPhotos(files: File[]) {
    const room = 12 - (work.data?.length ?? 0);
    if (room <= 0) return setErr("You can add up to 12 photos. Remove one to add another.");
    setUp(true); setErr("");
    try {
      const { data: ps } = await supabase.from("provider_services").select("service_id").eq("provider_id", prov.data!.id).limit(1);
      const batch = files.slice(0, room);
      for (let i = 0; i < batch.length; i++) {
        setProg(batch.length > 1 ? `Uploading ${i + 1} of ${batch.length}…` : "");
        const path = await uploadFile("portfolio", userId, "work", batch[i]!);
        const { error } = await supabase.from("portfolio_items").insert({ provider_id: prov.data!.id, service_id: ps?.[0]?.service_id ?? services[0]?.id, photo_path: path, caption: caption.trim() || "Past work" });
        if (error) throw error;
        await work.refetch();
      }
      setCaption(""); refresh();
      if (files.length > room) setErr(`Only ${room} more photos fit, so ${files.length - room} were skipped.`);
    } catch (e) { setErr(messageFrom(e)); } finally { setUp(false); setProg(""); }
  }
  async function removePhoto(id: string, path: string) {
    await supabase.from("portfolio_items").delete().eq("id", id); await supabase.storage.from("portfolio").remove([path]);
    await work.refetch(); qc.invalidateQueries({ queryKey: ["progress"] });
  }
  async function save() {
    setErr("");
    if ((work.data?.length ?? 0) < 3) return setErr("Add at least three photos of work you have completed.");
    if (r.some((x) => x.name.trim().length < 3 || !x.phone.trim() || !x.relationship)) return setErr("Fill in the name, phone number and relationship for both references.");
    setBusy(true);
    try { await rpc("save_references", { p_refs: r }); await refs.refetch(); refresh(); next(); }
    catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); }
  }
  return (
    <StepFrame title="Past work and references" intro="Customers trust what they can see. Our team also calls two people you have worked for." onSave={save} saving={busy} error={err} onBack={back}>
      <p className="mb-2 font-semibold">Photos of completed work ({work.data?.length ?? 0} added, 3 minimum, up to 12)</p>{prog && <p className="mb-2 text-xs font-semibold text-brand">{prog}</p>}
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {work.data?.map((w) => (
          <figure key={w.id} className="relative overflow-hidden rounded-xl border border-line">
            <img src={publicUrl("portfolio", w.photo_path) ?? ""} alt={w.caption ?? "Past work"} className="aspect-square w-full object-cover" />
            <button type="button" aria-label="Remove photo" onClick={() => removePhoto(w.id, w.photo_path)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-xs text-white">✕</button>
            <figcaption className="truncate px-2 py-1 text-[11px] text-muted">{w.caption}</figcaption>
          </figure>
        ))}
      </div>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row">
        <input aria-label="Photo caption" className="input" placeholder="Optional label, e.g. Water heater install, Ikeja" value={caption} onChange={(e) => setCaption(e.target.value)} />
        <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" aria-label="Work photos" onChange={(e) => { const x = Array.from(e.target.files ?? []); if (x.length) addPhotos(x); e.target.value = ""; }} />
        <Button type="button" variant="ghost" className="sm:!w-auto sm:!px-6" loading={up} onClick={() => fileRef.current?.click()}>Add photos</Button>
      </div>
      <p className="mb-2 font-semibold">Two people we can call about your work</p>
      <p className="mb-3 text-sm text-muted">Past customers or employers. They must have different phone numbers from each other and from your guarantor.</p>
      {r.map((x, i) => (
        <div key={i} className="mb-3 grid gap-2 rounded-2xl border border-line p-3 sm:grid-cols-3">
          <input aria-label={`Reference ${i + 1} name`} className="input" placeholder="Full name" value={x.name} onChange={(e) => setR(r.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
          <input aria-label={`Reference ${i + 1} phone`} className="input" inputMode="tel" placeholder="Phone number" value={x.phone} onChange={(e) => setR(r.map((y, j) => (j === i ? { ...y, phone: e.target.value } : y)))} />
          <select aria-label={`Reference ${i + 1} relationship`} className="input" value={x.relationship} onChange={(e) => setR(r.map((y, j) => (j === i ? { ...y, relationship: e.target.value } : y)))}>
            <option value="">Relationship…</option>{["Past customer", "Employer", "Estate manager", "Business client", "Colleague"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      ))}
    </StepFrame>
  );
}

/* ---------- 9. Review ---------- */
function ReviewStep({ p, back, goTo, onDone }: StepProps & { goTo: (i: number) => void; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [c, setC] = useState({ terms: false, privacy: false, safety: false });
  const [err, setErr] = useState("");
  const submit = useMutation({
    mutationFn: () => rpc("submit_verification", { p_consents: c }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["progress"] }); qc.invalidateQueries({ queryKey: ["my-provider"] }); toast("Application submitted. We review applications within 1 to 2 working days."); onDone(); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const items: [string, boolean, number][] = STEPS.slice(0, 8).map((s, i) => [s.title, s.done(p), i]);
  const incomplete = items.filter((i) => !i[1]);
  return (
    <StepFrame title="Review and submit" intro="Check that every section is complete. After you submit, you cannot edit your application unless our team asks for more information." onSave={() => (incomplete.length ? setErr(`Complete these sections first: ${incomplete.map((i) => i[0]).join(", ")}.`) : submit.mutate())} saving={submit.isPending} error={err} onBack={back} last>
      <ul className="mb-5 divide-y divide-line rounded-2xl border border-line">
        {items.map(([t, ok, i]) => (
          <li key={t} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="flex items-center gap-2"><span className={ok ? "text-success" : "text-danger"} aria-hidden>{ok ? "✓" : "!"}</span><b>{t}</b></span>
            <button onClick={() => goTo(i)} className="font-semibold text-brand hover:underline">{ok ? "Edit" : "Complete"}</button>
          </li>
        ))}
      </ul>
      <div className="mb-5 space-y-3">
        {([["terms", "I agree to the ConnectMe Terms of Service (see /legal/terms). I work as an independent contractor, I will not take customers off the platform, and I accept the dispute process."],
           ["privacy", "I consent to ConnectMe collecting and checking my identity documents, selfie, bank details and references, and contacting my guarantor and references, as described in the Privacy Notice."],
           ["safety", "I will follow the Safety Code of Conduct: arrive as the person verified here, ask for the customer’s door code, respect the customer’s home and property, and report any incident to ConnectMe."]] as const).map(([k, t]) => (
          <label key={k} className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-brand" checked={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.checked })} /><span>{t}</span></label>
        ))}
      </div>
      <Alert title="What happens next">Our team reviews your documents, calls your guarantor and references, and completes eight checks. You will be notified in the app. Reviews normally take 1 to 2 working days.</Alert>
      <div className="h-4" />
    </StepFrame>
  );
}
