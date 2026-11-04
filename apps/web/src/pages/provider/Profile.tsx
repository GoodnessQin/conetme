import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { supabase } from "../../lib/supabase";
import { messageFrom, publicUrl, rpc, uploadFile } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { useAreas, useMyProvider, useServices } from "../../lib/queries";
import type { ChangeRequest, PublicProvider } from "../../lib/types";
import { useAuth } from "../../auth/AuthProvider";
import { RATING_LABELS, StarRow } from "../../components/Rating";
import { Alert, Avatar, Button, Card, Dialog, Field, ListSkeleton, PageHeader, Pill, SectionTitle, Switch, useToast, VerifiedBadge } from "../../components/ui";

const KIND: Record<string, string> = { area: "Area change", service: "New service", photo: "Profile photo" };

export default function ProviderProfilePage() {
  const { session, profile } = useAuth();
  const uid = session!.user.id;
  const qc = useQueryClient();
  const toast = useToast();
  const prov = useMyProvider();
  const services = useServices().data ?? [];
  const areas = useAreas().data ?? [];
  const pid = prov.data?.id;
  const pub = useQuery({ queryKey: ["public-provider", pid], enabled: !!pid, queryFn: () => rpc<PublicProvider | null>("public_provider", { p_provider: pid }) });
  const mine = useQuery({ queryKey: ["my-services-full", pid], enabled: !!pid, queryFn: async () => ((await supabase.from("provider_services").select("service_id, typical_price_kobo, status").eq("provider_id", pid!)).data ?? []) as { service_id: string; typical_price_kobo: number | null; status: string }[] });
  const changes = useQuery({ queryKey: ["my-changes", pid], enabled: !!pid, queryFn: async () => ((await supabase.from("provider_change_requests").select("id, kind, status, payload, note, created_at").eq("provider_id", pid!).order("created_at", { ascending: false }).limit(10)).data ?? []) as ChangeRequest[] });
  const work = useQuery({ queryKey: ["portfolio-mine", pid], enabled: !!pid, queryFn: async () => ((await supabase.from("portfolio_items").select("id, photo_path, caption").eq("provider_id", pid!).order("created_at")).data ?? []) as { id: string; photo_path: string; caption: string | null }[] });

  const [bio, setBio] = useState<string | null>(null); const [radius, setRadius] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [dlg, setDlg] = useState<null | "area" | "service" | "photo">(null);
  const [areaId, setAreaId] = useState(""); const [svcId, setSvcId] = useState(""); const [svcPrice, setSvcPrice] = useState(""); const [svcNote, setSvcNote] = useState(""); const [docs, setDocs] = useState<string[]>([]);
  const [newPhoto, setNewPhoto] = useState<string | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const docInput = useRef<HTMLInputElement>(null); const photoInput = useRef<HTMLInputElement>(null); const workInput = useRef<HTMLInputElement>(null);

  if (prov.isLoading) return <ListSkeleton />;
  const d = prov.data;
  if (!d || d.status !== "approved") return <Alert title="Your provider profile opens once you are approved">Finish your application on the dashboard. After approval you can manage your profile, prices and work photos here.</Alert>;
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ["my-provider"] }); qc.invalidateQueries({ queryKey: ["public-provider", pid] }); };

  async function saveAbout() {
    const b = (bio ?? d!.bio ?? "").trim(); const r = Math.min(30, Math.max(1, Number(radius ?? d!.radius_km) || 10));
    if (b.length < 20) return setErr("Write at least 20 characters about your work.");
    setBusy(true); setErr("");
    const { error } = await supabase.from("providers").update({ bio: b, radius_km: r }).eq("id", pid!);
    setBusy(false);
    if (error) return setErr(messageFrom(error));
    setBio(null); setRadius(null); refreshAll(); toast("Profile saved.");
  }
  async function savePrice(serviceId: string) {
    const n = Number(prices[serviceId]);
    if (!(n >= 500)) return setErr("Enter a typical price of at least ₦500.");
    const { error } = await supabase.from("provider_services").update({ typical_price_kobo: Math.round(n * 100) }).eq("provider_id", pid!).eq("service_id", serviceId);
    if (error) return setErr(messageFrom(error));
    setErr(""); setPrices((p) => { const x = { ...p }; delete x[serviceId]; return x; }); mine.refetch(); toast("Price saved.");
  }
  const submitChange = useMutation({
    mutationFn: async (a: { kind: string; payload: Record<string, unknown> }) => rpc("request_provider_change", { p_kind: a.kind, p_payload: a.payload }),
    onSuccess: () => { setDlg(null); setDocs([]); setSvcNote(""); setSvcPrice(""); setSvcId(""); setAreaId(""); setNewPhoto(null); setErr(""); changes.refetch(); toast("Sent to our team. We will review it within 1 to 2 working days."); },
    onError: (e) => setErr(messageFrom(e)),
  });
  async function uploadDocs(files: File[]) {
    setBusy(true); setErr("");
    try { const out: string[] = []; for (const f of files.slice(0, 5 - docs.length)) out.push(await uploadFile("verification", uid, "credential", f)); setDocs((x) => [...x, ...out]); } catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); }
  }
  async function uploadNewPhoto(f: File) { setBusy(true); setErr(""); try { setNewPhoto(await uploadFile("avatars", uid, "avatar", f)); } catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); } }
  async function addWork(files: File[]) {
    const room = 12 - (work.data?.length ?? 0);
    if (room <= 0) return setErr("You can show up to 12 photos. Remove one to add another.");
    setBusy(true); setErr("");
    try {
      const first = mine.data?.[0]?.service_id;
      for (const f of files.slice(0, room)) {
        const path = await uploadFile("portfolio", uid, "work", f);
        const { error } = await supabase.from("portfolio_items").insert({ provider_id: pid!, service_id: first, photo_path: path });
        if (error) throw error;
      }
      work.refetch(); refreshAll();
    } catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); }
  }
  async function removeWork(id: string, path: string) {
    if ((work.data?.length ?? 0) <= 3) return setErr("Keep at least three work photos on your profile.");
    await supabase.from("portfolio_items").delete().eq("id", id); await supabase.storage.from("portfolio").remove([path]); work.refetch(); refreshAll();
  }
  const offered = new Set((mine.data ?? []).map((m) => m.service_id));
  const area = areas.find((a) => a.id === d.base_area_id);
  const pendingKinds = new Set((changes.data ?? []).filter((c) => c.status === "pending").map((c) => c.kind));
  const p = pub.data;

  return (
    <>
      <PageHeader title="Provider profile" subtitle="This is what customers see. Changes to your area, services and photo are checked by our team."
        actions={<Link to="/provider/preview" className="btn btn-ghost !w-auto !px-5 !py-2.5 !text-sm">See it as a customer</Link>} />
      {err && <div className="mb-4"><Alert tone="danger" title="Not saved">{err}</Alert></div>}

      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={d.display_name} path={profile?.avatar_path} size={64} />
          <div className="min-w-0 flex-1"><p className="text-xl font-extrabold leading-tight">{d.display_name}</p><VerifiedBadge level={d.level} />
            <p className="mt-1 flex items-center gap-2 text-sm">{p && p.rating_count > 0 ? <><StarRow value={p.rating} /><b>{Number(p.rating).toFixed(1)}</b><span className="text-muted">({p.rating_count})</span></> : <span className="text-muted">No ratings yet</span>}<span className="text-muted">· {d.jobs_completed} jobs</span></p></div>
          <div className="text-right"><p className="text-xs text-muted">Available today</p><Switch label="Available today" checked={d.available_today} onChange={async (v) => { await supabase.from("providers").update({ available_today: v }).eq("id", pid!); refreshAll(); }} /></div>
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle>About your work</SectionTitle>
        <Field label="About you" htmlFor="bio" hint="Customers read this first. No phone numbers or links."><textarea id="bio" rows={4} className="input" value={bio ?? d.bio ?? ""} onChange={(e) => setBio(e.target.value)} /></Field>
        <Field label="How far will you travel? (km)" htmlFor="rad" hint="Maximum 30 km."><input id="rad" className="input max-w-[140px]" inputMode="numeric" value={radius ?? String(d.radius_km)} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ""))} /></Field>
        <Button className="!w-auto !px-6" loading={busy} disabled={bio === null && radius === null} onClick={saveAbout}>Save</Button>
      </Card>

      <Card className="mt-4">
        <SectionTitle aside={<Button variant="ghost" className="!w-auto !px-4 !py-1.5 !text-sm" disabled={pendingKinds.has("service")} onClick={() => { setErr(""); setDlg("service"); }}>Offer another service</Button>}>Services and prices</SectionTitle>
        <ul className="divide-y divide-line">
          {(mine.data ?? []).map((m) => {
            const name = services.find((s) => s.id === m.service_id)?.name ?? "Service";
            const v = prices[m.service_id] ?? (m.typical_price_kobo ? String(m.typical_price_kobo / 100) : "");
            return (
              <li key={m.service_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><p className="font-bold">{name}</p><p className="text-xs text-muted">Typical starting price</p></div>
                <div className="flex items-center gap-2"><span className="text-sm font-bold">₦</span><input aria-label={`${name} price`} className="input !w-32" inputMode="numeric" value={v} onChange={(e) => setPrices({ ...prices, [m.service_id]: e.target.value.replace(/\D/g, "") })} />
                  <Button variant="soft" className="!w-auto !px-4 !py-2 !text-sm" disabled={prices[m.service_id] === undefined} onClick={() => savePrice(m.service_id)}>Save</Button></div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">The price here is only a guide on your profile. You set the real price on each offer. Adding a new service needs documents and a quick review.</p>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Where you work</SectionTitle>
          <p className="font-semibold">{area?.name ?? "Not set"}{area ? `, ${area.city}` : ""}</p>
          <Button variant="ghost" className="mt-3 !w-auto !px-5 !py-2 !text-sm" disabled={pendingKinds.has("area")} onClick={() => { setErr(""); setDlg("area"); }}>{pendingKinds.has("area") ? "Change pending" : "Request a change"}</Button>
          <p className="mt-2 text-xs text-muted">Your area decides which requests reach you, so changes are reviewed.</p>
        </Card>
        <Card>
          <SectionTitle>Profile photo</SectionTitle>
          <div className="flex items-center gap-3"><Avatar name={d.display_name} path={profile?.avatar_path} size={56} />
            <Button variant="ghost" className="!w-auto !px-5 !py-2 !text-sm" disabled={pendingKinds.has("photo")} onClick={() => { setErr(""); setDlg("photo"); }}>{pendingKinds.has("photo") ? "Change pending" : "Request a new photo"}</Button></div>
          <p className="mt-2 text-xs text-muted">Customers match your face to this photo at the door, so a new photo is checked against your verification selfie.</p>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionTitle aside={<><input ref={workInput} type="file" accept="image/*" multiple className="sr-only" aria-label="Add work photos" onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) addWork(f); e.target.value = ""; }} /><Button variant="ghost" className="!w-auto !px-4 !py-1.5 !text-sm" loading={busy} onClick={() => workInput.current?.click()}>Add photos</Button></>}>Work photos ({work.data?.length ?? 0} of 12)</SectionTitle>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {work.data?.map((w) => <div key={w.id} className="relative"><img src={publicUrl("portfolio", w.photo_path) ?? ""} alt={w.caption ?? "Past work"} className="aspect-square w-full rounded-xl object-cover" /><button type="button" aria-label="Remove photo" onClick={() => removeWork(w.id, w.photo_path)} className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-xs text-white">✕</button></div>)}
        </div>
      </Card>

      <Card className="mt-4" >
        <SectionTitle aside={<Link to="/provider/preview?tab=reviews" className="text-sm font-semibold text-brand">See all</Link>}>Reviews from customers</SectionTitle>
        {!p || p.reviews.length === 0 ? <p className="text-sm text-muted">No reviews yet. After each completed job the customer can rate you. Good ratings move you up in the list customers see.</p> : (
          <ul className="space-y-3">{p.reviews.slice(0, 3).map((r, i) => <li key={i} className="rounded-2xl bg-surface p-3"><div className="flex items-center gap-2"><StarRow value={r.stars} /><b className="text-sm">{RATING_LABELS[r.stars]}</b><span className="ml-auto text-xs text-muted">{fmtDate(r.at)}</span></div>{r.comment && <p className="mt-1 text-sm">{r.comment}</p>}{r.tags?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div>}</li>)}</ul>
        )}
      </Card>

      {(changes.data?.length ?? 0) > 0 && (
        <Card className="mt-4"><SectionTitle>Your change requests</SectionTitle>
          <ul className="divide-y divide-line">{changes.data!.map((c) => <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 text-sm"><div><p className="font-semibold">{KIND[c.kind]}</p><p className="text-xs text-muted">Sent {fmtDate(c.created_at)}{c.note ? ` · ${c.note}` : ""}</p></div><Pill tone={c.status === "approved" ? "success" : c.status === "rejected" ? "danger" : "warning"}>{c.status === "pending" ? "Under review" : c.status}</Pill></li>)}</ul></Card>
      )}

      <Dialog open={dlg === "area"} onClose={() => setDlg(null)} title="Request an area change"
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button loading={submitChange.isPending} disabled={!areaId} onClick={() => submitChange.mutate({ kind: "area", payload: { area_id: areaId } })}>Send for review</Button></>}>
        <p className="mb-3 text-sm text-muted">Choose the area you will work from. Your address proof must support it, so a reviewer may contact you.</p>
        <select aria-label="New area" className="input" value={areaId} onChange={(e) => setAreaId(e.target.value)}><option value="">Select…</option>{["Lagos", "Abuja"].map((c) => <optgroup key={c} label={c}>{areas.filter((a) => a.city === c && a.id !== d.base_area_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}</select>
        {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
      </Dialog>

      <Dialog open={dlg === "service"} onClose={() => setDlg(null)} title="Offer another service"
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button loading={submitChange.isPending} disabled={!svcId || docs.length === 0} onClick={() => submitChange.mutate({ kind: "service", payload: { service_id: svcId, typical_price_kobo: Math.round(Number(svcPrice) * 100), note: svcNote, doc_paths: docs } })}>Send for review</Button></>}>
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          <Field label="Service" htmlFor="ns"><select id="ns" className="input" value={svcId} onChange={(e) => setSvcId(e.target.value)}><option value="">Select…</option>{services.filter((s) => !offered.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          {svcId && <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted">{services.find((s) => s.id === svcId)?.credential_requirements.items.map((i) => <li key={i}>{i}</li>)}</ul>}
          <Field label="Typical starting price (₦)" htmlFor="np"><input id="np" className="input" inputMode="numeric" value={svcPrice} onChange={(e) => setSvcPrice(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Your experience with this service" htmlFor="nn" hint="At least 20 characters."><textarea id="nn" rows={3} className="input" value={svcNote} onChange={(e) => setSvcNote(e.target.value)} /></Field>
          <input ref={docInput} type="file" accept="image/*,application/pdf" multiple className="sr-only" aria-label="Credential documents" onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) uploadDocs(f); e.target.value = ""; }} />
          <Button variant="ghost" loading={busy} onClick={() => docInput.current?.click()}>{docs.length ? `Add more documents (${docs.length} added)` : "Upload credential documents"}</Button>
          {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
        </div>
      </Dialog>

      <Dialog open={dlg === "photo"} onClose={() => setDlg(null)} title="Request a new profile photo"
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button loading={submitChange.isPending} disabled={!newPhoto} onClick={() => submitChange.mutate({ kind: "photo", payload: { avatar_path: newPhoto } })}>Send for review</Button></>}>
        <p className="mb-3 text-sm text-muted">Use a clear photo of your face in good light. Our team compares it with your verification selfie before it replaces your current photo.</p>
        {newPhoto && <img src={publicUrl("avatars", newPhoto) ?? ""} alt="New profile" className="mx-auto mb-3 h-32 w-32 rounded-full object-cover" />}
        <input ref={photoInput} type="file" accept="image/*" capture="user" className="sr-only" aria-label="New profile photo" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadNewPhoto(f); e.target.value = ""; }} />
        <Button variant="ghost" loading={busy} onClick={() => photoInput.current?.click()}>{newPhoto ? "Choose a different photo" : "Take or choose a photo"}</Button>
        {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
      </Dialog>
    </>
  );
}

export function ProviderPreview() {
  const prov = useMyProvider();
  if (prov.isLoading) return <ListSkeleton />;
  if (!prov.data) return <Alert title="No provider profile yet">Complete your application first.</Alert>;
  return <ProviderProfileViewLazy id={prov.data.id} />;
}
import { ProviderProfileView } from "../customer/ProviderProfile";
function ProviderProfileViewLazy({ id }: { id: string }) { return <ProviderProfileView id={id} backLabel="Back to your profile" canRequest={false} />; }
