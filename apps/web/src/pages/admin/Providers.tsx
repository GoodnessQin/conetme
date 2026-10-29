import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc, messageFrom } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Alert, Button, Card, Dialog, EmptyState, ListSkeleton, PageHeader, Pill, Stars, useToast } from "../../components/ui";

interface Row { provider_id: string; name: string; phone: string | null; status: string; level: number; rating_avg: number; rating_count: number; jobs_completed: number; services: string[]; area_name: string | null; created_at: string; case_id: string | null; active_jobs: number }
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "brand"> = { approved: "success", suspended: "danger", submitted: "warning", in_review: "brand", needs_info: "warning", rejected: "danger", draft: "neutral" };

export default function AdminProviders() {
  const qc = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<{ row: Row; to: "suspended" | "approved" } | null>(null);
  const [reason, setReason] = useState(""); const [err, setErr] = useState("");
  const q = useQuery({ queryKey: ["admin-providers", query], queryFn: () => rpc<Row[]>("admin_providers", { p_query: query }) });
  const change = useMutation({
    mutationFn: () => rpc("admin_set_provider_status", { p_provider: sel!.row.provider_id, p_status: sel!.to, p_reason: reason }),
    onSuccess: () => { toast(sel!.to === "suspended" ? "Provider suspended." : "Provider reinstated."); setSel(null); setReason(""); qc.invalidateQueries({ queryKey: ["admin-providers"] }); },
    onError: (e) => setErr(messageFrom(e)),
  });
  return (
    <>
      <PageHeader title="Providers" subtitle="Everyone who has registered. Search by name or phone number." />
      <label htmlFor="ps" className="sr-only">Search providers</label>
      <input id="ps" className="input mb-4" placeholder="Search by name or phone number" value={query} onChange={(e) => setQuery(e.target.value)} />
      {q.isLoading && <ListSkeleton />}
      {q.data?.length === 0 && <EmptyState title="No providers found" body="Try a different name or number." />}
      <div className="space-y-3">
        {q.data?.map((r) => (
          <Card key={r.provider_id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">{r.name} <Pill tone={TONE[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</Pill></p>
                <p className="text-sm text-muted">{r.services.join(", ") || "No services"} · {r.area_name ?? "No area"} · {r.phone ? `+${r.phone.replace(/^\+/, "")}` : ""}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm"><Stars value={r.rating_avg} count={r.rating_count} /><span className="text-muted">{r.jobs_completed} jobs · {r.active_jobs} active · joined {fmtDate(r.created_at)}</span></div>
              </div>
              <div className="flex gap-2">
                {r.case_id && <Link to={`/admin/cases/${r.case_id}`} className="btn btn-ghost !w-auto !px-5 !py-2 !text-sm">Application</Link>}
                {r.status === "approved" && <Button variant="danger" className="!w-auto !px-5 !py-2 !text-sm" onClick={() => { setErr(""); setReason(""); setSel({ row: r, to: "suspended" }); }}>Suspend</Button>}
                {r.status === "suspended" && <Button className="!w-auto !px-5 !py-2 !text-sm" onClick={() => { setErr(""); setReason(""); setSel({ row: r, to: "approved" }); }}>Reinstate</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={!!sel} onClose={() => setSel(null)} title={sel?.to === "suspended" ? `Suspend ${sel.row.name}?` : `Reinstate ${sel?.row.name}?`}
        footer={<><Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button><Button variant={sel?.to === "suspended" ? "danger" : "primary"} loading={change.isPending} onClick={() => { setErr(""); change.mutate(); }}>{sel?.to === "suspended" ? "Suspend" : "Reinstate"}</Button></>}>
        {sel?.to === "suspended" && <p className="mb-3 text-sm text-muted">They stop receiving requests, their open offers are withdrawn, and they are told why. {sel.row.active_jobs > 0 ? `They have ${sel.row.active_jobs} active job(s), which continue and need your attention.` : ""}</p>}
        <label htmlFor="sr" className="mb-1 block text-sm font-semibold">Reason the provider will see</label>
        <textarea id="sr" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
      </Dialog>
    </>
  );
}
