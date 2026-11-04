import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { messageFrom, rpc } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Alert, Button, Card, Dialog, EmptyState, ListSkeleton, PageHeader, Pill, useToast } from "../../components/ui";
import AdminProviders from "./Providers";

export interface CustomerRow { user_id: string; name: string | null; phone: string | null; created_at: string; suspended: boolean; requests: number; jobs: number; disputes: number; spent_kobo: number; is_provider: boolean }

export function SuspendDialog({ target, onClose, onDone }: { target: { id: string; name: string; suspended: boolean } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState(""); const [err, setErr] = useState("");
  const m = useMutation({
    mutationFn: () => rpc("admin_set_customer_status", { p_user: target!.id, p_suspend: !target!.suspended, p_reason: reason }),
    onSuccess: () => { toast(target!.suspended ? "Account reinstated." : "Account suspended."); setReason(""); setErr(""); onDone(); onClose(); },
    onError: (e) => setErr(messageFrom(e)),
  });
  return (
    <Dialog open={!!target} onClose={onClose} title={target?.suspended ? `Reinstate ${target?.name}?` : `Suspend ${target?.name}?`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={target?.suspended ? "primary" : "danger"} loading={m.isPending} onClick={() => { setErr(""); m.mutate(); }}>{target?.suspended ? "Reinstate" : "Suspend"}</Button></>}>
      {!target?.suspended && <p className="mb-3 text-sm text-muted">They can still sign in and read, but cannot post requests, accept offers or pay. Jobs already in progress are not stopped.</p>}
      <label htmlFor="cr" className="mb-1 block text-sm font-semibold">Reason the person will see</label>
      <textarea id="cr" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
    </Dialog>
  );
}

function Customers() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<{ id: string; name: string; suspended: boolean } | null>(null);
  const q = useQuery({ queryKey: ["admin-customers", query], queryFn: () => rpc<CustomerRow[]>("admin_customers", { p_query: query }) });
  return (
    <>
      <label htmlFor="cs" className="sr-only">Search customers</label>
      <input id="cs" className="input mb-4" placeholder="Search by name or phone number" value={query} onChange={(e) => setQuery(e.target.value)} />
      {q.isLoading && <ListSkeleton />}
      {q.data?.length === 0 && <EmptyState title="Nobody found" body="Customer records are visible to the support and admin roles. Ask an admin to grant the support role if this stays empty." />}
      <div className="space-y-3">
        {q.data?.map((c) => (
          <Card key={c.user_id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">{c.name ?? "No name yet"} {c.suspended && <Pill tone="danger">Suspended</Pill>} {c.is_provider && <Pill tone="brand">Also a provider</Pill>}</p>
                <p className="text-sm text-muted">{c.phone ? `+${c.phone.replace(/^\+/, "")}` : ""} · joined {fmtDate(c.created_at)}</p>
                <p className="mt-1 text-xs text-muted">{c.requests} requests · {c.jobs} jobs · {c.disputes} disputes · {formatNaira(c.spent_kobo)} paid</p>
              </div>
              <div className="flex gap-2">
                <Link to={`/admin/customers/${c.user_id}`} className="btn btn-ghost !w-auto !px-5 !py-2 !text-sm">Open</Link>
                <Button variant={c.suspended ? "primary" : "danger"} className="!w-auto !px-5 !py-2 !text-sm" onClick={() => setTarget({ id: c.user_id, name: c.name ?? "this person", suspended: c.suspended })}>{c.suspended ? "Reinstate" : "Suspend"}</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <SuspendDialog target={target} onClose={() => setTarget(null)} onDone={() => qc.invalidateQueries({ queryKey: ["admin-customers"] })} />
    </>
  );
}

export default function People() {
  const [tab, setTab] = useState<"providers" | "customers">("providers");
  return (
    <>
      <PageHeader title="People" subtitle="Everyone on ConnectMe. Search, review their activity, and suspend accounts when needed." />
      <div className="mb-4 flex gap-2">{(["providers", "customers"] as const).map((k) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${tab === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line"}`}>{k}</button>)}</div>
      {tab === "providers" ? <AdminProviders embedded /> : <Customers />}
    </>
  );
}
