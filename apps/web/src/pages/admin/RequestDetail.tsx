import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import type { FieldDef } from "../../lib/types";
import { DetailsList } from "../../components/DynamicFields";
import { Alert, Card, KeyValue, ListSkeleton, PageHeader, Pill, SectionTitle } from "../../components/ui";

interface Detail {
  request: { id: string; status: string; details: Record<string, unknown>; urgent: boolean; time_slot: string | null; budget_kobo: number | null; created_at: string; expires_at: string | null };
  service: { name: string; form_schema: FieldDef[] }; customer: { id: string; name: string; phone: string }; area: string | null; address: string | null;
  notified: number; viewed: number; job_id: string | null;
  offers: { id: string; provider_id: string; provider: string; price_kobo: number; message: string | null; status: string; created_at: string; start_at: string | null; rating: number }[];
}

export default function AdminRequestDetail() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["admin-request", id], queryFn: () => rpc<Detail | null>("admin_request_detail", { p_request: id }) });
  if (q.isLoading) return <ListSkeleton />;
  const d = q.data;
  if (!d) return <Alert tone="danger" title="Not available">This request does not exist, or you do not have access.</Alert>;
  return (
    <>
      <PageHeader back={{ to: "/admin/activity", label: "Activity" }} title={d.service.name} subtitle={`${d.area ?? ""} · posted ${fmtDateTime(d.request.created_at)}`} actions={<Pill tone="brand">{d.request.status.replace("_", " ")}</Pill>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card><SectionTitle>Offers ({d.offers.length})</SectionTitle>
            {d.offers.length === 0 && <p className="text-sm text-muted">No offers yet. {d.notified} providers were alerted and {d.viewed} opened the request.</p>}
            <ul className="divide-y divide-line">{d.offers.map((o) => (
              <li key={o.id} className="py-3"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{o.provider} <span className="text-xs font-normal text-muted">★ {Number(o.rating).toFixed(1)}</span></p><p className="text-xs text-muted">{fmtDateTime(o.created_at)}{o.start_at ? ` · can start ${fmtDateTime(o.start_at)}` : ""}</p></div><div className="text-right"><p className="font-extrabold">{formatNaira(o.price_kobo)}</p><Pill tone={o.status === "accepted" ? "success" : "neutral"}>{o.status}</Pill></div></div>{o.message && <p className="mt-1 rounded-xl bg-surface p-2 text-sm">“{o.message}”</p>}</li>))}</ul>
          </Card>
          <Card><SectionTitle>The job request</SectionTitle><DetailsList schema={d.service.form_schema} details={d.request.details} /></Card>
        </div>
        <aside className="space-y-4">
          <Card><SectionTitle>Customer</SectionTitle><p className="font-bold"><Link className="text-brand hover:underline" to={`/admin/customers/${d.customer.id}`}>{d.customer.name}</Link></p><a href={`tel:${d.customer.phone}`} className="text-sm font-semibold text-brand">+{d.customer.phone?.replace(/^\+/, "")}</a></Card>
          <Card><KeyValue items={[["Address", d.address ?? ""], ["When", d.request.urgent ? "As soon as possible" : fmtDateTime(d.request.time_slot)], ["Budget", d.request.budget_kobo ? formatNaira(d.request.budget_kobo) : "Not set"], ["Providers alerted", String(d.notified)], ["Opened by", String(d.viewed)], ["Expires", fmtDateTime(d.request.expires_at)]]} /></Card>
          {d.job_id && <Link to={`/admin/jobs/${d.job_id}`} className="btn">Open the job</Link>}
        </aside>
      </div>
    </>
  );
}
