import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "../../lib/api";
import { fmtDateTime, timeAgo } from "../../lib/format";
import { EmptyState, ListSkeleton, PageHeader, Pill, ProgressBar } from "../../components/ui";

interface QueueRow { case_id: string; provider_id: string; display_name: string; provider_status: string; services: string[]; area_name: string | null; submitted_at: string; checks_passed: number; checks_total: number }
const TONE: Record<string, "warning" | "brand" | "success" | "danger" | "neutral"> = { submitted: "warning", in_review: "brand", approved: "success", rejected: "danger", needs_info: "neutral" };
const LABEL: Record<string, string> = { submitted: "New", in_review: "In review", approved: "Approved", rejected: "Rejected", needs_info: "Awaiting provider" };

export default function AdminQueue() {
  const [tab, setTab] = useState<"open" | "all">("open");
  const q = useQuery({ queryKey: ["admin-queue"], refetchInterval: 20_000, queryFn: () => rpc<QueueRow[]>("admin_queue") });
  const rows = (q.data ?? []).filter((r) => tab === "all" || ["submitted", "in_review"].includes(r.provider_status));
  return (
    <>
      <PageHeader title="Verification queue" subtitle="Review each applicant’s documents, call their guarantor and references, then decide." />
      <div className="mb-4 flex gap-2">
        {([["open", "Needs review"], ["all", "All applications"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line"}`}>{l}</button>
        ))}
      </div>
      {q.isLoading && <ListSkeleton />}
      {q.error && <EmptyState title="You do not have access" body="This area is for verifiers and admins. Ask an admin to grant the verifier role." />}
      {!q.isLoading && !q.error && rows.length === 0 && <EmptyState title="The queue is clear" body="New provider applications appear here as soon as they are submitted." />}
      <div className="space-y-3">
        {rows.map((r) => (
          <Link key={r.case_id} to={`/admin/cases/${r.case_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-bold">{r.display_name}</p><p className="text-sm text-muted">{r.services.join(", ")} · {r.area_name}</p><p className="text-xs text-muted" title={fmtDateTime(r.submitted_at)}>Submitted {timeAgo(r.submitted_at)}</p></div>
              <div className="w-40 text-right"><Pill tone={TONE[r.provider_status] ?? "neutral"}>{LABEL[r.provider_status] ?? r.provider_status}</Pill>
                <div className="mt-2"><ProgressBar value={(r.checks_passed / Math.max(r.checks_total, 1)) * 100} label="Checks passed" /></div>
                <p className="mt-1 text-xs text-muted">{r.checks_passed} of {r.checks_total || 8} checks passed</p></div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
