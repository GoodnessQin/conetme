import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import type { MatchProvider } from "../../lib/types";
import { useAreas, useServices } from "../../lib/queries";
import { messageFrom, rpc } from "../../lib/api";
import { defaultSlot, fmtDateTime } from "../../lib/format";
import { DynamicFields, validateFields, type Values } from "../../components/DynamicFields";
import { MapPicker, type LatLng } from "../../components/MapPicker";
import { Alert, Avatar, Button, Card, Field, KeyValue, ListSkeleton, PageHeader, Pill, ProgressBar, useToast } from "../../components/ui";

interface Prefill { note?: string; urgent?: boolean; budgetKobo?: number | null; areaId?: string; preferred?: { id: string; name: string } }
const LAGOS_DEFAULT: LatLng = { lat: 6.5244, lng: 3.3792 };

export default function RequestNew() {
  const { slug } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const pre = (useLocation().state ?? {}) as Prefill;
  const service = useServices().data?.find((s) => s.slug === slug);
  const areas = useAreas().data ?? [];

  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"all" | "pick">(pre.preferred ? "pick" : "all");
  const [picked, setPicked] = useState<string[]>(pre.preferred ? [pre.preferred.id] : []);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [areaId, setAreaId] = useState(pre.areaId ?? "");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [address, setAddress] = useState("");
  const [timing, setTiming] = useState<"asap" | "schedule">(pre.urgent ? "asap" : "schedule");
  const [slot, setSlot] = useState(defaultSlot(24));
  const [budget, setBudget] = useState(pre.budgetKobo ? String(Math.round(pre.budgetKobo / 100)) : "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const cov = useQuery({ queryKey: ["coverage", slug, areaId], enabled: !!areaId && !!slug, queryFn: () => rpc<number>("service_coverage", { p_service_slug: slug, p_area_id: areaId }) });
  const budgetKobo = budget ? Math.round(Number(budget) * 100) : null;
  const match = useQuery({
    queryKey: ["match", slug, areaId, pin?.lat, pin?.lng, budgetKobo, timing], enabled: step === 4 && !!areaId && !!pin && !!slug,
    queryFn: () => rpc<MatchProvider[]>("match_providers", { p_service_slug: slug, p_area_id: areaId, p_lat: pin!.lat, p_lng: pin!.lng, p_budget_kobo: budgetKobo, p_urgent: timing === "asap" }),
  });
  const schema = service?.form_schema ?? [];
  const merged = useMemo<Values>(() => {
    const main = schema.find((f) => f.type === "textarea" && f.required);
    return main && pre.note && values[main.name] === undefined ? { ...values, [main.name]: pre.note } : values;
  }, [schema, values, pre.note]);
  const area = areas.find((a) => a.id === areaId);
  const center: LatLng = area ? { lat: area.lat, lng: area.lng } : LAGOS_DEFAULT;

  if (!service) return <ListSkeleton rows={2} />;

  function next() {
    if (step === 1) {
      const e = validateFields(schema, merged);
      setErrors(e);
      if (Object.keys(e).length) return;
      setValues(merged);
    }
    if (step === 2) {
      const e: Record<string, string> = {};
      if (!areaId) e.area = "Choose the area where the work will happen.";
      if (!pin) e.pin = "Drop a pin on the map so the provider can find the exact spot.";
      if (address.trim().length < 8) e.address = "Add the full address, including the flat number or a landmark.";
      if (timing === "schedule" && new Date(slot).getTime() < Date.now()) e.slot = "Choose a time in the future.";
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    setStep(step + 1);
    window.scrollTo({ top: 0 });
  }

  async function post() {
    setBusy(true); setFormError("");
    try {
      const details: Record<string, unknown> = {};
      for (const f of schema) {
        const v = merged[f.name];
        if (v === undefined || (Array.isArray(v) ? v.length === 0 : v === "")) continue;
        details[f.name] = f.type === "number" ? Number(v) : v;
      }
      const id = await rpc<string>("create_request", {
        p_service_slug: service!.slug, p_details: details, p_area_id: areaId, p_address: address.trim(),
        p_lat: pin!.lat, p_lng: pin!.lng,
        p_time_slot: timing === "asap" ? new Date().toISOString() : new Date(slot).toISOString(),
        p_urgent: timing === "asap", p_budget_kobo: budget ? Math.round(Number(budget) * 100) : null,
        p_preferred_provider: pre.preferred?.id ?? null,
        p_invited: !pre.preferred && mode === "pick" ? picked : null,
      });
      await qc.invalidateQueries({ queryKey: ["my-requests"] });
      toast(pre.preferred ? `Request sent to ${pre.preferred.name}.` : "Request posted. Verified providers nearby have been alerted.");
      nav(`/customer/requests/${id}`, { replace: true });
    } catch (e) { setFormError(messageFrom(e)); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader back={{ to: "/customer", label: "Home" }} title={`Request a ${service.name.toLowerCase()}`}
        subtitle={service.pricing_mode === "quote" ? "The provider visits first for a paid site inspection, then sends a full quote." : "Describe the job once. Verified providers send you their price."} />
      {pre.preferred && <div className="mb-4"><Alert title={`Booking ${pre.preferred.name} again`}>This request goes to {pre.preferred.name.split(" ")[0]} only. If they are unavailable, you will be told straight away.</Alert></div>}
      <div className="mb-5"><ProgressBar value={(step / 4) * 100} label={`Step ${step} of 4`} /><p className="mt-1 text-xs font-semibold text-muted">Step {step} of 4 · {["The job", "Where and when", "Budget and review", "Who should quote"][step - 1]}</p></div>

      <Card>
        {step === 1 && <DynamicFields schema={schema} values={merged} errors={errors} onChange={(n, v) => setValues({ ...merged, [n]: v })} />}

        {step === 2 && (
          <>
            <Field label="Area" htmlFor="area" error={errors.area}>
              <select id="area" className="input" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                <option value="">Select…</option>
                {["Lagos", "Abuja"].map((c) => <optgroup key={c} label={c}>{areas.filter((a) => a.city === c).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
              </select>
              {cov.data === 0 && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">No verified {service.name.toLowerCase()} providers cover this area yet. You can still post, but nobody will see the request until one is approved.</p>}
              {(cov.data ?? 0) > 0 && <p className="mt-2 text-sm font-semibold text-success">✓ {cov.data} verified {service.name.toLowerCase()} {cov.data === 1 ? "provider covers" : "providers cover"} this area.</p>}
            </Field>
            <Field label="Pin the exact location" error={errors.pin} hint="Only the provider you hire sees the pin, and only after you pay.">
              <MapPicker center={center} value={pin} onChange={setPin} />
            </Field>
            <Field label="Address and directions" htmlFor="addr" error={errors.address} hint="Flat or house number, estate, street and a landmark.">
              <textarea id="addr" rows={2} className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Flat 4, 12 Admiralty Way, Lekki Phase 1, opposite the Total filling station" />
            </Field>
            <fieldset className="mb-2">
              <legend className="mb-2 text-sm font-semibold">When do you need it?</legend>
              {([["asap", "As soon as possible", "Only providers who are available today are alerted."], ["schedule", "Choose a date and time", "Providers see your preferred time and can propose theirs."]] as const).map(([v, t, d]) => (
                <label key={v} className={`mb-2 flex cursor-pointer gap-3 rounded-2xl border p-4 ${timing === v ? "border-brand bg-brand-50" : "border-line"}`}>
                  <input type="radio" name="timing" className="mt-1 accent-brand" checked={timing === v} onChange={() => setTiming(v)} />
                  <span><b>{t}</b><br /><span className="text-sm text-muted">{d}</span></span>
                </label>
              ))}
              {timing === "schedule" && <Field label="Preferred date and time" htmlFor="slot" error={errors.slot}><input id="slot" type="datetime-local" className="input" value={slot} min={defaultSlot(0)} onChange={(e) => setSlot(e.target.value)} /></Field>}
            </fieldset>
          </>
        )}

        {step === 3 && (
          <>
            <Field label="Your budget in naira (optional)" htmlFor="budget" hint="Providers see this and can price to it. You can still accept a higher or lower offer.">
              <input id="budget" className="input" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} placeholder="25000" />
            </Field>
            <KeyValue items={[
              ["Service", service.name], ["Area", area?.name ?? ""], ["Address", address.trim()],
              ["When", timing === "asap" ? "As soon as possible" : fmtDateTime(new Date(slot).toISOString())],
              ["Budget", budget ? formatNaira(Number(budget) * 100) : "Not set"],
              ["Stays open for", timing === "asap" ? "2 hours" : "24 hours"],
            ]} />
            <div className="mt-4"><Alert title="What happens next">
              {pre.preferred ? `${pre.preferred.name.split(" ")[0]} is alerted without seeing your name, phone number or address. ` : "Verified providers within range are alerted without seeing your name, phone number or address. "}
              You compare offers, ratings and profiles, then choose. You pay only after you accept.
            </Alert></div>
            {formError && <div className="mt-4"><Alert tone="danger" title="We could not post your request">{formError}</Alert></div>}
          </>
        )}
        {step === 4 && (
          <>
            {!pre.preferred && (
              <fieldset className="mb-4">
                <legend className="mb-2 text-sm font-semibold">Who should send you a price?</legend>
                {([["all", "Everyone who fits", "The best matching providers nearby are alerted. You usually get more offers, faster."], ["pick", "I will choose", "Pick up to 3 providers below. Only they are alerted."]] as const).map(([v, t, d]) => (
                  <label key={v} className={`mb-2 flex cursor-pointer gap-3 rounded-2xl border p-4 ${mode === v ? "border-brand bg-brand-50" : "border-line"}`}>
                    <input type="radio" name="mode" className="mt-1 accent-brand" checked={mode === v} onChange={() => setMode(v)} />
                    <span><b>{t}</b><br /><span className="text-sm text-muted">{d}</span></span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="mb-2 text-sm font-semibold">{match.data ? `${(pre.preferred ? match.data.filter((m) => m.provider_id === pre.preferred!.id) : match.data).length} verified ${service.name.toLowerCase()} provider(s) match` : "Finding providers"}</p>
            {match.isLoading && <ListSkeleton rows={2} />}
            {match.data && match.data.length === 0 && <Alert tone="warning" title="No verified providers fit right now">Nobody who covers your pin is available for this request. You can still post it, but try a different time or area if you can.</Alert>}
            <ul className="space-y-2">
              {(pre.preferred ? (match.data ?? []).filter((m) => m.provider_id === pre.preferred!.id) : match.data ?? []).map((m) => {
                const on = picked.includes(m.provider_id);
                const selectable = mode === "pick" && !pre.preferred;
                return (
                  <li key={m.provider_id}>
                    <label className={`flex items-center gap-3 rounded-2xl border p-3 ${selectable ? "cursor-pointer" : ""} ${on ? "border-brand bg-brand-50" : "border-line"}`}>
                      {selectable && <input type="checkbox" className="h-5 w-5 flex-none accent-brand" checked={on} disabled={!on && picked.length >= 3} onChange={() => setPicked(on ? picked.filter((x) => x !== m.provider_id) : [...picked, m.provider_id])} aria-label={`Choose ${m.name}`} />}
                      <Avatar name={m.name} path={m.avatar_path} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold leading-tight">{m.name}</p>
                        <p className="text-xs text-muted">{m.rating_count ? `★ ${Number(m.rating_avg).toFixed(1)} (${m.rating_count})` : "New on ConnectMe"} · {m.jobs_completed} jobs · {m.distance_km} km</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">{m.available_today && <Pill tone="success">Available today</Pill>}{budget && (m.within_budget ? <Pill tone="brand">Fits your budget</Pill> : <Pill tone="warning">Above budget</Pill>)}</div>
                      </div>
                      <div className="text-right"><p className="text-xs text-muted">Usually</p><p className="text-sm font-extrabold">{formatNaira(m.price_low_kobo)} to {formatNaira(m.price_high_kobo)}</p>
                        <a href={`/customer/providers/${m.provider_id}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>Profile</a></div>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-muted">Profiles show ratings and work. No phone numbers or contact details are ever shown, so all talking and payment stays on ConnectMe.</p>
            {mode === "pick" && !pre.preferred && <p className="mt-1 text-xs font-semibold text-muted">{picked.length} of 3 chosen</p>}
            {formError && <div className="mt-4"><Alert tone="danger" title="We could not post your request">{formError}</Alert></div>}
          </>
        )}
      </Card>

      <div className="mt-4 flex gap-3">
        {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)} className="sm:max-w-[140px]">Back</Button>}
        {step < 4 ? <Button onClick={next}>Continue</Button> : <Button onClick={post} loading={busy} disabled={mode === "pick" && picked.length === 0}>{pre.preferred ? `Send to ${pre.preferred.name.split(" ")[0]}` : "Post request"}</Button>}
      </div>
    </div>
  );
}
