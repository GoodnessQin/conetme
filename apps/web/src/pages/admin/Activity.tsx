import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../../lib/api";
import { fmtDateTime, timeAgo } from "../../lib/format";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "../../components/ui";

interface Req { request_id: string; service_name: string; customer_name: string; area_name: string | null; status: string; created_at: string; urgent: boolean; budget_kobo: number | null; offers_count: number; notified_count: number; job_id: string | null }
interface Job { job_id: string; service_name: string; customer_name: string; provider_name: string; total_kobo: number; status: string; created_at: string; has_dispute: boolean }
const REQ_STATUS = ["all", "open", "offers_received", "accepted", "expired", "cancelled"];
const JOB_STATUS = ["all", "awaiting_payment", "paid_held", "on_the_way", "arrived", "working", "completed_by_provider", "paid_out", "disputed", "refunded", "cancelled"];

export default function Activity() {
  const [tab, setTab] = useState<"requests" | "jobs">("requests");
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all");
  const reqs = useQuery({ queryKey: ["admin-requests", query, status], enabled: tab === "requests", refetchInterval: 20_000, queryFn: () => rpc<Req[]>("admin_requests", { p_query: query, p_status: status }) });
  const jobs = useQuery({ queryKey: ["admin-jobs", query, status], enabled: tab === "jobs", refetchInterval: 20_000, queryFn: () => rpc<Job[]>("admin_jobs", { p_query: query, p_status: status }) });
  const opts = tab === "requests" ? REQ_STATUS : JOB_STATUS;
  return (
    <>
      <PageHeader title="Activity" subtitle="Every request and job on the platform, with the offers, payments and timeline behind it." />
      <div className="mb-3 flex gap-2">{(["requests", "jobs"] as const).map((k) => <button key={k} onClick={() => { setTab(k); setStatus("all"); }} aria-pressed={tab === k} className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${tab === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line"}`}>{k}</button>)}</div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input aria-label="Search" className="input" placeholder={tab === "requests" ? "Search by customer, phone or service" : "Search by customer, provider, phone or job ID"} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Status" className="input sm:max-w-[220px]" value={status} onChange={(e) => setStatus(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o === "all" ? "All statuses" : o.replace(/_/g, " ")}</option>)}</select>
      </div>
      {(reqs.isLoading || jobs.isLoading) && <ListSkeleton />}
      {(reqs.error || jobs.error) && <EmptyState title="You do not have access" body="Activity is visible to the support and admin roles." />}
      {tab === "requests" && reqs.data?.length === 0 && <EmptyState title="No requests match" body="Try another search or status." />}
      {tab === "requests" && <div className="space-y-3">{reqs.data?.map((r) => (
        <Link key={r.request_id} to={`/admin/requests/${r.request_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{r.service_name}{r.urgent && <span className="ml-2 text-xs font-bold text-danger">URGENT</span>}</p><p className="text-sm text-muted">{r.customer_name} · {r.area_name} · {timeAgo(r.created_at)}</p><p className="text-xs text-muted">{r.notified_count} providers alerted · {r.offers_count} offers{r.budget_kobo ? ` · budget ${formatNaira(r.budget_kobo)}` : ""}</p></div><Pill tone={r.status === "accepted" ? "brand" : r.status === "offers_received" ? "success" : r.status === "expired" ? "warning" : "neutral"}>{r.status.replace("_", " ")}</Pill></div>
        </Link>))}</div>}
      {tab === "jobs" && jobs.data?.length === 0 && <EmptyState title="No jobs match" body="Try another search or status." />}
      {tab === "jobs" && <div className="space-y-3">{jobs.data?.map((j) => (
        <Link key={j.job_id} to={`/admin/jobs/${j.job_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{j.service_name}</p><p className="text-sm text-muted">{j.customer_name} with {j.provider_name}</p><p className="text-xs text-muted">{fmtDateTime(j.created_at)}</p></div>
            <div className="text-right"><p className="font-extrabold">{formatNaira(j.total_kobo)}</p><div className="flex justify-end gap-1">{j.has_dispute && <Pill tone="warning">Dispute</Pill>}<Pill tone={j.status === "paid_out" ? "success" : "neutral"}>{j.status.replace(/_/g, " ")}</Pill></div></div></div>
        </Link>))}</div>}
    </>
  );
}
