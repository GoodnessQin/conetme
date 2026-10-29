import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../lib/api";
import type { JobListRow, MyProvider } from "../lib/types";
import { fmtDate } from "../lib/format";
import { Avatar, Button, Card, EmptyState, ListSkeleton, PageHeader, Pill, Stars, VerifiedBadge } from "../components/ui";
import { JOB_STATUS } from "./JobDetail";

const DONE = ["paid_out", "refunded", "split_resolved", "cancelled"];
type Tab = "active" | "done" | "providers";

export default function JobList({ role }: { role: "customer" | "provider" }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("active");
  const jobs = useQuery({ queryKey: ["my-jobs"], queryFn: () => rpc<JobListRow[]>("my_jobs"), refetchInterval: 15_000 });
  const provs = useQuery({ queryKey: ["my-providers"], enabled: role === "customer", queryFn: () => rpc<MyProvider[]>("my_providers") });
  const rows = (jobs.data ?? []).filter((j) => j.role === role);
  const active = rows.filter((j) => !DONE.includes(j.status));
  const done = rows.filter((j) => DONE.includes(j.status));
  const toRate = done.filter((j) => j.status === "paid_out" && !j.reviewed).length;
  const tabs: [Tab, string][] = role === "customer" ? [["active", `In progress (${active.length})`], ["done", `Completed (${done.length})`], ["providers", "My providers"]] : [["active", `In progress (${active.length})`], ["done", `Completed (${done.length})`]];
  const list = tab === "active" ? active : done;

  return (
    <>
      <PageHeader title="My jobs" subtitle={role === "customer" ? "Your bookings, the people you have worked with, and your ratings." : "Jobs you have won, with the payout you receive."} />
      {toRate > 0 && role === "customer" && <div className="mb-4 rounded-2xl bg-lime p-3 text-sm font-semibold">You have {toRate} completed {toRate === 1 ? "job" : "jobs"} waiting for your rating. Open it from Completed.</div>}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line"}`}>{l}</button>)}
      </div>

      {jobs.isLoading && <ListSkeleton />}
      {tab !== "providers" && !jobs.isLoading && list.length === 0 && (
        <EmptyState title={tab === "active" ? "Nothing in progress" : "No completed jobs yet"} body={role === "customer" ? "When you accept an offer, the booking appears here from payment to completion." : "When a customer accepts your offer, the job appears here."} />
      )}
      {tab !== "providers" && (
        <div className="space-y-3">
          {list.map((j) => {
            const s = JOB_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
            return (
              <Link key={j.job_id} to={`/jobs/${j.job_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-bold">{j.service_name}</p><p className="text-sm text-muted">{role === "customer" ? j.counterpart : `Customer: ${j.counterpart}`} · {j.area_name} · {fmtDate(j.created_at)}</p>
                    {j.status === "paid_out" && (j.my_stars ? <p className="mt-1 text-sm text-amber-500" aria-label={`You rated ${j.my_stars} out of 5`}>{"★".repeat(j.my_stars)}<span className="text-line">{"★".repeat(5 - j.my_stars)}</span></p> : <p className="mt-1 text-sm font-bold text-brand">Rate this job</p>)}</div>
                  <div className="text-right"><p className="font-extrabold">{formatNaira(j.total_kobo)}</p><Pill tone={s.tone}>{s.label}</Pill></div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {tab === "providers" && (
        <>
          {provs.isLoading && <ListSkeleton />}
          {provs.data?.length === 0 && <EmptyState title="No providers yet" body="After a job is completed, the provider is saved here so you can book them again in one tap." />}
          <div className="space-y-3">
            {provs.data?.map((p) => (
              <Card key={p.provider_id}>
                <div className="flex items-start gap-3">
                  <Avatar name={p.name} path={p.avatar_path} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{p.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2"><VerifiedBadge level={p.level} /><Stars value={p.rating_avg} count={p.rating_count} /></div>
                    <p className="mt-1 text-sm text-muted">{p.services.join(", ")} · {p.jobs_together} {p.jobs_together === 1 ? "job" : "jobs"} together · last {fmtDate(p.last_job_at)}</p>
                    {p.my_stars && <p className="text-sm text-amber-500" aria-label={`You rated ${p.my_stars}`}>You rated {"★".repeat(p.my_stars)}</p>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link to={`/customer/providers/${p.provider_id}`} className="btn btn-ghost !py-2.5 !text-sm">Profile</Link>
                  <Button className="!py-2.5 !text-sm" onClick={() => nav(`/customer/new/${p.service_slugs[0]}`, { state: { preferred: { id: p.provider_id, name: p.name } } })}>Book again</Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
