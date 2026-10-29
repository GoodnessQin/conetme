import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { messageFrom, rpc } from "../../lib/api";
import { useServices } from "../../lib/queries";
import { timeAgo } from "../../lib/format";
import type { FieldDef, Service } from "../../lib/types";
import { Alert, Button, Card, Dialog, EmptyState, Field, ListSkeleton, PageHeader, Pill, Switch, useToast } from "../../components/ui";

interface Interest { kind: string; text: string; service_slug: string | null; area_name: string | null; created_at: string }
const STAGES = [
  { id: "single", label: "One payment (100%)", stages: [{ label: "Full payment", percent: 100 }] },
  { id: "deposit", label: "50% deposit, 50% balance", stages: [{ label: "Deposit", percent: 50 }, { label: "Balance", percent: 50 }] },
  { id: "three", label: "40% start, 40% middle, 20% finish", stages: [{ label: "Start of work", percent: 40 }, { label: "Middle of work", percent: 40 }, { label: "Completion", percent: 20 }] },
] as const;
const TYPES = [["text", "Short answer"], ["textarea", "Long answer"], ["number", "Number"], ["select", "Choose one"], ["multiselect", "Choose several"]] as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "field";

interface Draft { id: string | null; name: string; description: string; pricing: "fixed" | "quote"; stage: string; customStages: string; keywords: string; inspection: string; credItems: string; credNote: string; questions: { label: string; type: FieldDef["type"]; required: boolean; options: string }[]; active: boolean; cap: number }
const blank = (): Draft => ({ id: null, name: "", description: "", pricing: "fixed", stage: "single", customStages: "", keywords: "", inspection: "", credItems: "Certificates, licences or permits that apply to this work\nPhotos or documents that show you have done this work before", credNote: "Upload at least one document. A reviewer may ask for more.", questions: [{ label: "Describe the job", type: "textarea", required: true, options: "" }], active: true, cap: 10_000_000 });

function toDraft(s: Service): Draft {
  const pct = (s.milestone_template ?? []).map((m) => m.percent).join("/");
  const known = STAGES.find((x) => x.stages.map((m) => m.percent).join("/") === pct);
  return {
    id: s.id, name: s.name, description: s.description ?? "", pricing: s.pricing_mode === "quote" ? "quote" : "fixed", stage: known?.id ?? "custom", customStages: pct.replace(/\//g, ", "),
    keywords: (s.keywords ?? []).join(", "), inspection: s.inspection_fee_kobo ? String(s.inspection_fee_kobo / 100) : "",
    credItems: (s.credential_requirements?.items ?? []).join("\n"), credNote: s.credential_requirements?.note ?? "",
    questions: s.form_schema.map((f) => ({ label: f.label, type: f.type, required: !!f.required, options: (f.options ?? []).join(", ") })), active: s.active ?? true, cap: s.job_cap_kobo ?? 10_000_000,
  };
}

export default function AdminServices() {
  const qc = useQueryClient();
  const toast = useToast();
  const services = useServices();
  const [tab, setTab] = useState<"services" | "demand">("services");
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const demand = useQuery({ queryKey: ["interest"], enabled: tab === "demand", queryFn: () => rpc<Interest[]>("admin_service_interest") });

  const save = useMutation({
    mutationFn: async (x: Draft) => {
      const stages = x.stage === "custom"
        ? x.customStages.split(",").map((n, i) => ({ label: `Payment ${i + 1}`, percent: Number(n.trim()) })).filter((m) => m.percent > 0)
        : [...(STAGES.find((s) => s.id === x.stage)?.stages ?? STAGES[0].stages)];
      const form = x.questions.filter((q) => q.label.trim()).map((q) => ({
        name: slug(q.label), label: q.label.trim(), type: q.type, required: q.required,
        ...(q.type === "select" || q.type === "multiselect" ? { options: q.options.split(",").map((o) => o.trim()).filter(Boolean) } : {}),
      }));
      if (form.some((f) => (f.type === "select" || f.type === "multiselect") && (f.options?.length ?? 0) < 2)) throw new Error("Each “choose” question needs at least two options, separated by commas.");
      return rpc<string>("admin_upsert_service", {
        p_id: x.id, p_name: x.name, p_description: x.description, p_pricing_mode: x.pricing, p_keywords: x.keywords.split(",").map((k) => k.trim()).filter(Boolean),
        p_form_schema: form, p_milestones: stages, p_credentials: { items: x.credItems.split("\n").map((i) => i.trim()).filter(Boolean), note: x.credNote.trim() },
        p_inspection_fee_kobo: x.pricing === "quote" ? Math.round(Number(x.inspection || 0) * 100) : 0, p_job_cap_kobo: x.cap, p_active: x.active,
      });
    },
    onSuccess: () => { toast("Service saved. It is live for customers and providers."); setD(null); qc.invalidateQueries({ queryKey: ["services"] }); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const up = (patch: Partial<Draft>) => setD((x) => (x ? { ...x, ...patch } : x));

  return (
    <>
      <PageHeader title="Services" subtitle="Any service can be added here. Providers register for it, customers request it, and no code change is needed."
        actions={<Button className="!w-auto !px-6" onClick={() => { setErr(""); setD(blank()); }}>Add a service</Button>} />
      <div className="mb-4 flex gap-2">
        {([["services", "Services"], ["demand", "Customer demand"]] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line"}`}>{l}</button>)}
      </div>

      {tab === "services" && (services.isLoading ? <ListSkeleton /> : (
        <div className="space-y-3">
          {services.data?.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-bold">{s.name} {s.active === false && <Pill tone="warning">Hidden</Pill>}</p><p className="text-sm text-muted">{s.description}</p>
                  <p className="mt-1 text-xs text-muted">{s.pricing_mode === "quote" ? "Inspection first, then quote" : "Fixed price"} · {(s.milestone_template ?? []).map((m) => `${m.percent}%`).join(" + ")} · {s.form_schema.length} questions · {(s.keywords ?? []).length} keywords{s.inspection_fee_kobo ? ` · inspection ${formatNaira(s.inspection_fee_kobo)}` : ""}</p></div>
                <Button variant="ghost" className="!w-auto !px-5 !py-2 !text-sm" onClick={() => { setErr(""); setD(toDraft(s)); }}>Edit</Button>
              </div>
            </Card>
          ))}
        </div>
      ))}

      {tab === "demand" && (
        <>
          <p className="mb-3 text-sm text-muted">What customers searched for that we do not offer, and areas where they found no providers. Use this to decide which services to open and where to recruit.</p>
          {demand.isLoading && <ListSkeleton />}
          {demand.data?.length === 0 && <EmptyState title="No signals yet" body="When a customer asks for a service we do not offer, it shows up here." />}
          <div className="space-y-2">{demand.data?.map((r, i) => <Card key={i}><div className="flex items-start justify-between gap-3"><p className="font-semibold">“{r.text}”</p><Pill tone={r.kind === "unmatched" ? "brand" : "warning"}>{r.kind === "unmatched" ? "Not offered" : "No providers"}</Pill></div><p className="text-xs text-muted">{r.area_name ?? "No area"} · {timeAgo(r.created_at)}</p></Card>)}</div>
        </>
      )}

      <Dialog open={!!d} onClose={() => setD(null)} title={d?.id ? "Edit service" : "Add a service"}
        footer={<><Button variant="ghost" onClick={() => setD(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => { setErr(""); if (d) save.mutate(d); }}>Save service</Button></>}>
        {d && (
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <Field label="Service name" htmlFor="sn"><input id="sn" className="input" value={d.name} onChange={(e) => up({ name: e.target.value })} placeholder="Hair stylist" /></Field>
            <Field label="Short description" htmlFor="sd"><input id="sd" className="input" value={d.description} onChange={(e) => up({ description: e.target.value })} placeholder="Braids, weaves and styling at home" /></Field>
            <Field label="Words customers use to ask for it" htmlFor="sk" hint="Separate with commas. Customers who type these words are matched to this service."><input id="sk" className="input" value={d.keywords} onChange={(e) => up({ keywords: e.target.value })} placeholder="hair, braids, weave, stylist" /></Field>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="How is it priced?" htmlFor="sp"><select id="sp" className="input" value={d.pricing} onChange={(e) => up({ pricing: e.target.value as Draft["pricing"] })}><option value="fixed">One price for the job</option><option value="quote">Paid inspection first, then a quote</option></select></Field>
              <Field label="Payment stages" htmlFor="ss"><select id="ss" className="input" value={d.stage} onChange={(e) => up({ stage: e.target.value })}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}<option value="custom">Custom split</option></select></Field>
            </div>
            {d.stage === "custom" && <Field label="Custom split (percentages)" htmlFor="sc" hint="Up to 5 numbers that add up to 100, e.g. 30, 30, 40."><input id="sc" className="input" value={d.customStages} onChange={(e) => up({ customStages: e.target.value })} /></Field>}
            {d.pricing === "quote" && <Field label="Typical inspection fee (₦)" htmlFor="si"><input id="si" className="input" inputMode="numeric" value={d.inspection} onChange={(e) => up({ inspection: e.target.value.replace(/\D/g, "") })} /></Field>}

            <p className="mb-1 mt-2 text-sm font-semibold">Questions customers answer</p>
            {d.questions.map((q, i) => (
              <div key={i} className="mb-2 rounded-2xl border border-line p-3">
                <div className="flex gap-2"><input aria-label={`Question ${i + 1}`} className="input" placeholder="Question" value={q.label} onChange={(e) => up({ questions: d.questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <button type="button" aria-label="Remove question" onClick={() => up({ questions: d.questions.filter((_, j) => j !== i) })} className="px-2 text-danger">✕</button></div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <select aria-label="Answer type" className="input !w-auto" value={q.type} onChange={(e) => up({ questions: d.questions.map((x, j) => (j === i ? { ...x, type: e.target.value as FieldDef["type"] } : x)) })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={q.required} onChange={(e) => up({ questions: d.questions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} />Required</label>
                </div>
                {(q.type === "select" || q.type === "multiselect") && <input aria-label="Options" className="input mt-2" placeholder="Options, separated by commas" value={q.options} onChange={(e) => up({ questions: d.questions.map((x, j) => (j === i ? { ...x, options: e.target.value } : x)) })} />}
              </div>
            ))}
            <Button type="button" variant="soft" className="!py-2 !text-sm" onClick={() => up({ questions: [...d.questions, { label: "", type: "text", required: false, options: "" }] })}>Add a question</Button>

            <p className="mb-1 mt-5 text-sm font-semibold">What providers must show to prove competence</p>
            <textarea aria-label="Credential requirements" rows={4} className="input" value={d.credItems} onChange={(e) => up({ credItems: e.target.value })} />
            <p className="mt-1 text-xs text-muted">One requirement per line.</p>
            <Field label="Note to providers" htmlFor="cn"><input id="cn" className="input" value={d.credNote} onChange={(e) => up({ credNote: e.target.value })} /></Field>
            <div className="mt-2 flex items-center justify-between rounded-2xl bg-surface p-3"><span className="text-sm font-semibold">Visible to customers and providers</span><Switch label="Visible" checked={d.active} onChange={(v) => up({ active: v })} /></div>
            {err && <div className="mt-3"><Alert tone="danger" title="Not saved">{err}</Alert></div>}
          </div>
        )}
      </Dialog>
    </>
  );
}
