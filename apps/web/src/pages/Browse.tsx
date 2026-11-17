import { Link, useSearchParams } from "react-router-dom";
import { LocationPicker, stateLabel } from "../components/LocationPicker";
import { ProviderCard } from "../components/ProviderCard";
import { SearchIcon } from "../components/icons";
import { EmptyState, Skeleton } from "../components/ui";
import { useMarket } from "../lib/market";
import { useAreas, useServices } from "../lib/queries";

const SORTS: [string, string][] = [["top", "Top rated"], ["jobs", "Most jobs done"], ["new", "Newest"]];

/** Search and filter everything. Every filter lives in the URL, so a search can be shared. */
export default function Browse() {
  const [sp, setSp] = useSearchParams();
  const services = useServices().data ?? [];
  const areas = useAreas().data ?? [];
  const f = { q: sp.get("q") ?? "", service: sp.get("service") ?? "", area: sp.get("area") ?? "", state: sp.get("state") ?? "", sort: sp.get("sort") ?? "top" };
  const res = useMarket({ ...f, limit: 48 });
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const area = areas.find((a) => a.id === f.area);
  const svc = services.find((s) => s.slug === f.service);
  const filtered = !!(f.q || f.service || f.area || f.state);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-3xl font-extrabold tracking-tight">{svc ? `${svc.name}s` : "Find a provider"}{area ? ` in ${area.name}` : f.state ? ` in ${stateLabel(f.state)}` : ""}</h1>
      <div className="mt-4 grid gap-3 rounded-3xl border border-line bg-white p-4 shadow-sm lg:grid-cols-[1.2fr_1.6fr]">
        <div className="flex items-center gap-3 rounded-2xl bg-surface px-4"><SearchIcon size={20} /><input aria-label="Search providers" value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Search by name or need" className="w-full bg-transparent py-3 focus:outline-none" /></div>
        <LocationPicker value={f.area} onChange={(id) => set("area", id)} onStateChange={(s) => { const n = new URLSearchParams(sp); n.delete("area"); if (s) n.set("state", s); else n.delete("state"); setSp(n, { replace: true }); }} initialState={f.state} allowAny remember={false} idPrefix="browse" compact />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={() => set("service", "")} className={`rounded-full border px-4 py-2 text-sm font-bold ${!f.service ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>All</button>
        {services.map((s) => <button key={s.id} onClick={() => set("service", s.slug)} className={`rounded-full border px-4 py-2 text-sm font-bold ${f.service === s.slug ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand"}`}>{s.name}</button>)}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">Sort<select value={f.sort} onChange={(e) => set("sort", e.target.value)} className="rounded-full border border-line bg-white px-3 py-2 text-sm font-semibold text-ink">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {res.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}
        {(res.data ?? []).map((c) => <ProviderCard key={c.provider_id} c={c} />)}
      </div>
      {res.isError && <EmptyState title="Could not load providers" body="Check your connection and try again." />}
      {res.data && res.data.length === 0 && (
        <EmptyState title={filtered ? "No providers match yet" : "Providers are joining now"}
          body={<>Nobody{svc ? ` offering ${svc.name.toLowerCase()}` : ""} is listed {area ? `in ${area.name}` : "here"} right now. Post a request and we will alert verified providers as soon as one can help.</>}
          action={<Link to={`/customer/new/${f.service || services[0]?.slug || "plumber"}`} state={{ areaId: f.area || undefined }} className="inline-flex rounded-full bg-brand px-6 py-3 font-bold text-white">Post a request</Link>} />
      )}
      {res.data && res.data.length > 0 && (
        <div className="mt-8 rounded-3xl bg-surface p-5 md:flex md:items-center md:justify-between">
          <div><p className="font-extrabold">Not sure who to pick?</p><p className="text-sm text-muted">Describe the job once and verified providers send you their price.</p></div>
          <Link to={`/customer/new/${f.service || services[0]?.slug || "plumber"}`} state={{ areaId: f.area || undefined }} className="mt-3 inline-flex rounded-full bg-brand px-6 py-3 font-bold text-white md:mt-0">Post a request</Link>
        </div>
      )}
    </div>
  );
}
