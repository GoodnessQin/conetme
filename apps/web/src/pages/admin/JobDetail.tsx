import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Alert, Card, KeyValue, ListSkeleton, PageHeader, Pill, SectionTitle } from "../../components/ui";

interface Detail {
  job: { id: string; status: string; total_kobo: number; commission_bps: number; created_at: string }; service: string; request_id: string;
  customer: { id: string; name: string; phone: string }; provider: { id: string; name: string; phone: string; rating: number }; address: string | null;
  milestones: { id: string; label: string; amount_kobo: number; status: string }[];
  payments: { reference: string; amount_kobo: number; status: string; provider: string; fee_kobo: number; paid_at: string | null }[];
  payouts: { net_kobo: number; commission_kobo: number; status: string; processed_at: string | null }[];
  refunds: { amount_kobo: number; reason: string; status: string }[];
  events: { event: string; note: string | null; at: string }[];
  dispute: { id: string; status: string; reason: string; detail: string; resolution: string | null } | null;
  messages: { from: string; body: string; at: string }[] | null; messages_hidden: boolean;
}

export default function AdminJobDetail() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["admin-job", id], refetchInterval: 15_000, queryFn: () => rpc<Detail | null>("admin_job_detail", { p_job: id }) });
  if (q.isLoading) return <ListSkeleton />;
  const d = q.data;
  if (!d) return <Alert tone="danger" title="Not available">This job does not exist, or you do not have access.</Alert>;
  return (
    <>
      <PageHeader back={{ to: "/admin/activity", label: "Activity" }} title={d.service} subtitle={`${formatNaira(d.job.total_kobo)} · booked ${fmtDateTime(d.job.created_at)}`} actions={<Pill tone="brand">{d.job.status.replace(/_/g, " ")}</Pill>} />
      {d.dispute && <div className="mb-4"><Alert tone={d.dispute.status === "open" ? "warning" : "info"} title={`Dispute: ${d.dispute.reason.replace(/_/g, " ")} (${d.dispute.status})`}>{d.dispute.detail} {d.dispute.status === "open" && <Link to="/admin/disputes" className="font-bold text-brand underline">Decide it in Disputes</Link>}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card><SectionTitle>Timeline</SectionTitle><ol className="space-y-3">{d.events.slice().reverse().map((e, i) => <li key={i} className="flex gap-3 text-sm"><span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-brand" /><div><p className="font-semibold">{e.note ?? e.event}</p><p className="text-xs text-muted">{fmtDateTime(e.at)}</p></div></li>)}</ol></Card>
          <Card>
            <SectionTitle>Chat</SectionTitle>
            {d.messages_hidden ? <p className="text-sm text-muted">Chat is private. It is shown here only when a problem has been reported on the job, and each time it is opened is logged.</p> : (
              <ul className="space-y-2">{d.messages?.map((m, i) => <li key={i} className={`rounded-2xl p-3 text-sm ${m.from === "customer" ? "bg-surface" : "bg-brand-50"}`}><p className="text-xs font-bold capitalize text-muted">{m.from} · {fmtDateTime(m.at)}</p><p>{m.body}</p></li>)}</ul>
            )}
          </Card>
        </div>
        <aside className="space-y-4">
          <Card><SectionTitle>People</SectionTitle>
            <p className="text-xs font-semibold uppercase text-muted">Customer</p><p className="font-bold"><Link className="text-brand hover:underline" to={`/admin/customers/${d.customer.id}`}>{d.customer.name}</Link></p><a href={`tel:${d.customer.phone}`} className="text-sm font-semibold text-brand">+{d.customer.phone?.replace(/^\+/, "")}</a>
            <p className="mt-3 text-xs font-semibold uppercase text-muted">Provider</p><p className="font-bold">{d.provider.name} <span className="text-xs font-normal text-muted">★ {Number(d.provider.rating).toFixed(1)}</span></p><a href={`tel:${d.provider.phone}`} className="text-sm font-semibold text-brand">+{d.provider.phone?.replace(/^\+/, "")}</a>
            <p className="mt-3 text-xs font-semibold uppercase text-muted">Address</p><p className="text-sm">{d.address}</p>
            <Link to={`/admin/requests/${d.request_id}`} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">See the request and all offers</Link></Card>
          <Card><SectionTitle>Money</SectionTitle>
            <KeyValue items={d.milestones.map((m): [string, string] => [m.label, `${formatNaira(m.amount_kobo)} · ${m.status.replace("_", " ")}`])} />
            {d.payments.length > 0 && <><p className="mt-3 text-xs font-semibold uppercase text-muted">Payments</p><ul className="text-xs">{d.payments.map((p) => <li key={p.reference} className="break-all py-1">{p.reference} · {p.provider} · {formatNaira(p.amount_kobo)} · {p.status}{p.fee_kobo ? ` · fee ${formatNaira(p.fee_kobo)}` : ""}</li>)}</ul></>}
            {d.payouts.length > 0 && <><p className="mt-3 text-xs font-semibold uppercase text-muted">Payouts</p><ul className="text-xs">{d.payouts.map((p, i) => <li key={i} className="py-1">{formatNaira(p.net_kobo)} to provider (fee {formatNaira(p.commission_kobo)}) · {p.status}</li>)}</ul></>}
            {d.refunds.length > 0 && <><p className="mt-3 text-xs font-semibold uppercase text-muted">Refunds</p><ul className="text-xs">{d.refunds.map((r, i) => <li key={i} className="py-1">{formatNaira(r.amount_kobo)} · {r.reason} · {r.status}</li>)}</ul></>}</Card>
        </aside>
      </div>
    </>
  );
}
