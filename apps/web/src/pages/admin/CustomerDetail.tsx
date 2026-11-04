import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../../lib/api";
import { fmtDate, fmtDateTime } from "../../lib/format";
import { Alert, Avatar, Button, Card, ListSkeleton, PageHeader, Pill, SectionTitle } from "../../components/ui";
import { SuspendDialog } from "./People";

interface Detail {
  profile: { id: string; name: string | null; phone: string | null; created_at: string; suspended_at: string | null; suspended_reason: string | null; avatar: string | null } | null;
  requests: { id: string; service: string; status: string; created_at: string; offers: number }[];
  jobs: { id: string; service: string; status: string; total_kobo: number; provider: string; created_at: string }[];
  disputes: { id: string; job_id: string; reason: string; status: string; created_at: string }[];
}

export default function CustomerDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; name: string; suspended: boolean } | null>(null);
  const q = useQuery({ queryKey: ["admin-customer", id], queryFn: () => rpc<Detail>("admin_customer_detail", { p_user: id }) });
  if (q.isLoading) return <ListSkeleton />;
  if (!q.data?.profile) return <Alert tone="danger" title="Not available">You may not have access to customer records, or this person does not exist.</Alert>;
  const { profile: p, requests, jobs, disputes } = q.data;
  return (
    <>
      <PageHeader back={{ to: "/admin/people", label: "People" }} title={p.name ?? "No name yet"} subtitle={p.phone ? `+${p.phone.replace(/^\+/, "")} · joined ${fmtDate(p.created_at)}` : ""}
        actions={<Button variant={p.suspended_at ? "primary" : "danger"} className="!w-auto !px-6" onClick={() => setTarget({ id: p.id, name: p.name ?? "this person", suspended: !!p.suspended_at })}>{p.suspended_at ? "Reinstate" : "Suspend"}</Button>} />
      {p.suspended_at && <div className="mb-4"><Alert tone="danger" title={`Suspended ${fmtDate(p.suspended_at)}`}>{p.suspended_reason}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><SectionTitle>Requests ({requests.length})</SectionTitle>
          {requests.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          <ul className="divide-y divide-line">{requests.map((r) => <li key={r.id}><Link to={`/admin/requests/${r.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand"><span><b>{r.service}</b><br /><span className="text-xs text-muted">{fmtDateTime(r.created_at)} · {r.offers} offers</span></span><Pill>{r.status.replace("_", " ")}</Pill></Link></li>)}</ul></Card>
        <Card><SectionTitle>Jobs ({jobs.length})</SectionTitle>
          {jobs.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          <ul className="divide-y divide-line">{jobs.map((j) => <li key={j.id}><Link to={`/admin/jobs/${j.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand"><span><b>{j.service}</b> with {j.provider}<br /><span className="text-xs text-muted">{fmtDateTime(j.created_at)}</span></span><span className="text-right"><b>{formatNaira(j.total_kobo)}</b><br /><Pill>{j.status.replace(/_/g, " ")}</Pill></span></Link></li>)}</ul></Card>
      </div>
      {disputes.length > 0 && <Card className="mt-4"><SectionTitle>Disputes</SectionTitle><ul className="divide-y divide-line">{disputes.map((d) => <li key={d.id}><Link to={`/admin/jobs/${d.job_id}`} className="flex justify-between py-2.5 text-sm hover:text-brand"><span>{d.reason.replace(/_/g, " ")} · {fmtDate(d.created_at)}</span><Pill tone={d.status === "open" ? "warning" : "neutral"}>{d.status}</Pill></Link></li>)}</ul></Card>}
      <p className="mt-6 flex items-center gap-2 text-xs text-muted"><Avatar name={p.name ?? "?"} path={p.avatar} size={20} /> Customer records are visible to support and admin roles only, and access is logged.</p>
      <SuspendDialog target={target} onClose={() => setTarget(null)} onDone={() => qc.invalidateQueries({ queryKey: ["admin-customer", id] })} />
    </>
  );
}
