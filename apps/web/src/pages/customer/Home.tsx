import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira, interpretRequest } from "@connectme/shared";
import { useAuth } from "../../auth/AuthProvider";
import { useAreas, useServices } from "../../lib/queries";
import { rpc } from "../../lib/api";
import type { MyRequest } from "../../lib/types";
import { Button, Card, Pill, useToast } from "../../components/ui";
import { timeLeft } from "../../lib/format";

export default function CustomerHome() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const services = useServices().data ?? [];
  const areas = useAreas().data ?? [];
  const [text, setText] = useState("");
  const [areaId, setAreaId] = useState("");
  const [none, setNone] = useState<null | { kind: "unmatched" | "coverage"; slug?: string }>(null);
  const toast = useToast();
  const catalog = services.map((x) => ({ slug: x.slug, keywords: [...(x.keywords ?? []), x.name.toLowerCase()] }));
  const [err, setErr] = useState("");
  const requests = useQuery({ queryKey: ["my-requests"], queryFn: () => rpc<MyRequest[]>("my_requests"), refetchInterval: 15_000 });
  const live = (requests.data ?? []).filter((r) => ["open", "offers_received"].includes(r.status)).slice(0, 3);

  function start(slug: string) {
    const i = interpretRequest(text, catalog);
    nav(`/customer/new/${slug}`, { state: { note: text.trim(), urgent: i.urgent, budgetKobo: i.budgetKobo, areaId } });
  }
  async function find() {
    if (text.trim().length < 8) return setErr("Tell us a little more about the job.");
    setErr(""); setNone(null);
    const i = interpretRequest(text, catalog);
    if (!i.service) {
      rpc("record_service_interest", { p_text: text, p_area_id: areaId || null, p_kind: "unmatched", p_service_slug: null }).catch(() => undefined);
      return setNone({ kind: "unmatched" });
    }
    if (areaId) {
      try {
        const n = await rpc<number>("service_coverage", { p_service_slug: i.service, p_area_id: areaId });
        if (n === 0) return setNone({ kind: "coverage", slug: i.service });
      } catch { /* fall through and let the request page explain */ }
    }
    start(i.service);
  }
  const areaName = areas.find((a) => a.id === areaId)?.name ?? "your area";
  const noneService = services.find((x) => x.slug === none?.slug);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight md:text-4xl">Hi {profile?.full_name?.split(" ")[0]}, what do you need done?</h1>
      <div className="mt-5 rounded-3xl border border-line bg-white p-4 shadow-sm">
        <label htmlFor="need" className="sr-only">Describe the job</label>
        <textarea id="need" rows={3} value={text} onChange={(e) => { setText(e.target.value); setNone(null); }}
          placeholder="Describe it in your own words. For example: my kitchen tap is leaking and I need a plumber today."
          className="w-full resize-none border-0 bg-transparent p-1 text-lg placeholder:text-muted/60 focus:outline-none" />
        {err && <p role="alert" className="mt-1 text-sm text-danger">{err}</p>}
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row">
          <label htmlFor="area" className="sr-only">Area</label>
          <select id="area" value={areaId} onChange={(e) => setAreaId(e.target.value)} className="input sm:max-w-[220px]">
            <option value="">Your area</option>
            {["Lagos", "Abuja"].map((c) => <optgroup key={c} label={c}>{areas.filter((a) => a.city === c).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
          </select>
          <Button onClick={find} className="sm:flex-1">Find providers</Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Or choose a service:</span>
        {services.map((s) => (
          <button key={s.id} onClick={() => start(s.slug)} className="rounded-full border border-line bg-white px-4 py-2 text-sm font-bold hover:border-brand hover:text-brand">{s.name}</button>
        ))}
      </div>

      {none?.kind === "unmatched" && (
        <Card className="mt-4 border-2 border-lime">
          <p className="text-lg font-bold">We do not offer that service yet</p>
          <p className="mt-1 text-sm text-muted">We could not match “{text.trim()}” to a service on ConnectMe. We have noted that you asked for it. We open new services based on what customers ask for, and verified providers can register for any service we open.</p>
          <p className="mt-3 text-sm font-semibold">Available now</p>
          <div className="mt-2 flex flex-wrap gap-2">{services.map((x) => <button key={x.id} onClick={() => start(x.slug)} className="rounded-full border border-line px-4 py-2 text-sm font-bold hover:border-brand hover:text-brand">{x.name}</button>)}</div>
        </Card>
      )}
      {none?.kind === "coverage" && none.slug && (
        <Card className="mt-4 border-2 border-lime">
          <p className="text-lg font-bold">No verified {noneService?.name.toLowerCase()} providers cover {areaName} yet</p>
          <p className="mt-1 text-sm text-muted">You can still post your request, but no one will see it until a provider in range is approved. We can also prioritise recruiting {noneService?.name.toLowerCase()} providers in {areaName}.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => start(none.slug!)}>Post anyway</Button>
            <Button onClick={() => { rpc("record_service_interest", { p_text: text, p_area_id: areaId || null, p_kind: "no_coverage", p_service_slug: none.slug }).catch(() => undefined); toast("Noted. We will prioritise this area."); setNone(null); }}>Tell us to recruit here</Button>
          </div>
        </Card>
      )}

      {live.length > 0 && (
        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Open requests</h2><Link to="/customer/requests" className="text-sm font-semibold text-brand">See all</Link></div>
          <div className="space-y-3">
            {live.map((r) => (
              <Link key={r.request_id} to={`/customer/requests/${r.request_id}`} className="flex items-center justify-between gap-3 rounded-card border border-line bg-white p-4 hover:border-brand">
                <div><p className="font-bold">{r.service_name}</p><p className="text-sm text-muted">{r.area_name} · {timeLeft(r.expires_at)}</p></div>
                <div className="text-right"><Pill tone={r.offers_count ? "success" : "neutral"}>{r.offers_count ? `${r.offers_count} ${r.offers_count === 1 ? "offer" : "offers"}` : "Waiting"}</Pill>
                  {r.best_price_kobo && <p className="mt-1 text-xs text-muted">From {formatNaira(r.best_price_kobo)}</p>}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 grid gap-4 text-sm sm:grid-cols-3">
        {[["Verified people", "ID, guarantor, address and references checked by our team."], ["Held payment", "Your money is released only after you confirm the job."], ["Door code", "Only the person you booked can start the work."]].map(([t, d]) => (
          <div key={t}><p className="font-bold">{t}</p><p className="text-muted">{d}</p></div>
        ))}
      </div>
    </div>
  );
}
