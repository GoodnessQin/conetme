import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { messageFrom, publicUrl, uploadFile } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import { useMarket } from "../../lib/market";
import { useServices } from "../../lib/queries";
import type { MarketBanner } from "../../lib/types";
import { Button, Card, Dialog, Field, ListSkeleton, PageHeader, Pill, Switch, useToast } from "../../components/ui";
import { rpc } from "../../lib/api";

interface Draft { id: string | null; title: string; subtitle: string; link: string; image_path: string | null; active: boolean; sort_order: string }
const blank = (): Draft => ({ id: null, title: "", subtitle: "", link: "/browse", image_path: null, active: true, sort_order: "10" });

function Thumb({ path }: { path: string | null }) {
  const u = publicUrl("portfolio", path);
  return u ? <img src={u} alt="" className="h-14 w-24 flex-none rounded-xl object-cover" /> : <span className="grid h-14 w-24 flex-none place-items-center rounded-xl bg-surface text-xs text-muted">No image</span>;
}

/** What the public sees: homepage banners, category pictures and featured providers. */
export default function AdminBanners() {
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const services = useServices();
  const market = useMarket({ limit: 60 });
  const q = useQuery({ queryKey: ["admin-banners"], queryFn: async () => { const { data, error } = await supabase.from("marketplace_banners").select("*").order("sort_order"); if (error) throw error; return data as MarketBanner[]; } });
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const svcFile = useRef<HTMLInputElement>(null);
  const [svcTarget, setSvcTarget] = useState<string | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ["admin-banners"] }); qc.invalidateQueries({ queryKey: ["banners"] }); };

  const save = useMutation({
    mutationFn: async (x: Draft) => {
      const row = { title: x.title.trim(), subtitle: x.subtitle.trim() || null, link: x.link.trim() || null, image_path: x.image_path, active: x.active, sort_order: Number(x.sort_order) || 0 };
      const r = x.id ? await supabase.from("marketplace_banners").update(row).eq("id", x.id) : await supabase.from("marketplace_banners").insert(row);
      if (r.error) throw new Error(r.error.message.includes("check") ? "Title must be 3 to 80 characters, the link must start with /, and the subtitle at most 140." : r.error.message);
    },
    onSuccess: () => { done(); setD(null); toast("Banner saved."); }, onError: (e) => setErr(messageFrom(e)),
  });
  const remove = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("marketplace_banners").delete().eq("id", id); if (error) throw error; }, onSuccess: () => { done(); toast("Banner deleted."); }, onError: (e) => toast(messageFrom(e)) });
  const feature = useMutation({ mutationFn: (v: { id: string; on: boolean }) => rpc("admin_set_featured", { p_provider: v.id, p_featured: v.on }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["market"] }); }, onError: (e) => toast(messageFrom(e)) });

  async function pickBanner(f?: File) {
    if (!f || !session || !d) return;
    setBusy(true); setErr("");
    try { setD({ ...d, image_path: await uploadFile("portfolio", session.user.id, "banner", f) }); } catch (e) { setErr(messageFrom(e)); } finally { setBusy(false); }
  }
  async function pickService(f?: File) {
    if (!f || !session || !svcTarget) return;
    try {
      const path = await uploadFile("portfolio", session.user.id, "service", f);
      const { error } = await supabase.from("services").update({ image_path: path }).eq("id", svcTarget);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["services"] }); toast("Category image updated.");
    } catch (e) { toast(messageFrom(e)); }
  }
  if (q.isLoading) return <ListSkeleton />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Banners and featured" subtitle="Control what visitors see first on the marketplace."
        actions={<Button className="!w-auto !px-5 !py-2.5 !text-sm" onClick={() => { setErr(""); setD(blank()); }}>Add banner</Button>} />

      <h2 className="mb-2 text-lg font-extrabold">Homepage banners</h2>
      {(q.data ?? []).length === 0 && <Card><p className="text-sm text-muted">No banners yet, so visitors see our three default banners. Add one to replace them.</p></Card>}
      <div className="space-y-3">
        {(q.data ?? []).map((b) => (
          <Card key={b.id}><div className="flex items-center gap-3"><Thumb path={b.image_path} />
            <div className="min-w-0 flex-1"><p className="truncate font-bold">{b.title}</p><p className="truncate text-sm text-muted">{b.subtitle}</p><div className="mt-1">{b.active ? <Pill tone="success">Showing</Pill> : <Pill>Hidden</Pill>}</div></div>
            <div className="flex flex-col gap-1 text-sm font-bold"><button className="text-brand" onClick={() => { setErr(""); setD({ id: b.id, title: b.title, subtitle: b.subtitle ?? "", link: b.link ?? "", image_path: b.image_path, active: b.active, sort_order: String(b.sort_order) }); }}>Edit</button>
              <button className="text-danger" onClick={() => { if (confirm("Delete this banner?")) remove.mutate(b.id); }}>Delete</button></div></div></Card>
        ))}
      </div>

      <h2 className="mb-2 mt-8 text-lg font-extrabold">Category pictures</h2>
      <Card>
        <input ref={svcFile} type="file" accept="image/*" hidden onChange={(e) => { void pickService(e.target.files?.[0]); e.target.value = ""; }} />
        <ul className="divide-y divide-line">
          {(services.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3"><Thumb path={s.image_path ?? null} /><b className="flex-1">{s.name}</b>
              <button className="text-sm font-bold text-brand" onClick={() => { setSvcTarget(s.id); svcFile.current?.click(); }}>{s.image_path ? "Replace" : "Upload"}</button></li>
          ))}
        </ul>
      </Card>

      <h2 className="mb-2 mt-8 text-lg font-extrabold">Featured providers</h2>
      <p className="mb-2 text-sm text-muted">Featured providers appear first in search and carry a badge. Use it sparingly and fairly.</p>
      <Card>
        {(market.data ?? []).length === 0 ? <p className="text-sm text-muted">No approved providers yet.</p> : (
          <ul className="divide-y divide-line">{(market.data ?? []).map((m) => (
            <li key={m.provider_id} className="flex items-center justify-between py-2.5 text-sm"><span><b>{m.name}</b> <span className="text-muted">{m.service_name} · {m.area}</span></span>
              <Switch checked={m.featured} onChange={(on) => feature.mutate({ id: m.provider_id, on })} label={`Feature ${m.name}`} /></li>
          ))}</ul>
        )}
      </Card>

      <Dialog open={!!d} onClose={() => setD(null)} title={d?.id ? "Edit banner" : "Add a banner"}
        footer={<><Button variant="ghost" onClick={() => setD(null)}>Cancel</Button><Button loading={save.isPending || busy} onClick={() => { setErr(""); if (d) save.mutate(d); }}>Save banner</Button></>}>
        {d && (<>
          <Field label="Headline" htmlFor="bt"><input id="bt" className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Weddings sorted" /></Field>
          <Field label="One line under it" htmlFor="bs"><input id="bs" className="input" value={d.subtitle} onChange={(e) => setD({ ...d, subtitle: e.target.value })} /></Field>
          <Field label="Where the button goes" htmlFor="bl" hint="A page on ConnectMe, for example /browse?service=caterer"><input id="bl" className="input" value={d.link} onChange={(e) => setD({ ...d, link: e.target.value })} /></Field>
          <Field label="Picture" hint="Wide photos work best. Without a picture we use a brand colour."><div className="flex items-center gap-3"><Thumb path={d.image_path} />
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void pickBanner(e.target.files?.[0]); e.target.value = ""; }} />
            <Button variant="ghost" className="!w-auto !px-5 !py-2 !text-sm" loading={busy} onClick={() => file.current?.click()}>{d.image_path ? "Replace" : "Upload"}</Button></div></Field>
          <Field label="Order" htmlFor="bo" hint="Lowest number shows first."><input id="bo" className="input" inputMode="numeric" value={d.sort_order} onChange={(e) => setD({ ...d, sort_order: e.target.value.replace(/\D/g, "") })} /></Field>
          <Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label="Showing on the marketplace" />
          {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
        </>)}
      </Dialog>
    </div>
  );
}
