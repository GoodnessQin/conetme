import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { messageFrom, rpc } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { Alert, Button, Card, Dialog, EmptyState, ListSkeleton, PageHeader, Pill, useToast } from "../../components/ui";

interface Row { dispute_id: string; job_id: string; service_name: string; customer_name: string; provider_name: string; reason: string; detail: string; opened_by_role: string; held_kobo: number; created_at: string; dispute_status: string; resolution: string | null; resolved_note: string | null }
const REASONS: Record<string, string> = { no_show: "Provider did not show up", poor_work: "Poor quality work", price_changed: "Price changed", damage: "Damage", safety: "Safety concern", other: "Other" };
const OUTCOMES = [["refund_customer", "Refund the customer", "The customer gets all held money back."], ["pay_provider", "Pay the provider", "The provider is paid in full, minus commission."], ["split_50_50", "Split 50/50", "Half is refunded. Half goes to the provider, minus commission."]] as const;

export default function Disputes() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin-disputes"], refetchInterval: 20_000, queryFn: () => rpc<Row[]>("admin_disputes") });
  const [sel, setSel] = useState<Row | null>(null);
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState(""); const [err, setErr] = useState("");
  const resolve = useMutation({
    mutationFn: () => rpc("admin_resolve_dispute", { p_dispute: sel!.dispute_id, p_resolution: outcome, p_note: note }),
    onSuccess: () => { toast("Dispute resolved. Both people have been told."); setSel(null); qc.invalidateQueries({ queryKey: ["admin-disputes"] }); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const open = (q.data ?? []).filter((d) => d.dispute_status === "open");
  const closed = (q.data ?? []).filter((d) => d.dispute_status !== "open");
  return (
    <>
      <PageHeader title="Disputes" subtitle="Payment stays held until you decide. Read both sides, then choose an outcome and explain it." />
      {q.isLoading && <ListSkeleton />}
      {!q.isLoading && open.length === 0 && <EmptyState title="No open disputes" body="Problems reported by customers or providers appear here." />}
      <div className="space-y-3">
        {open.map((d) => (
          <Card key={d.dispute_id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-bold">{d.service_name} · {REASONS[d.reason] ?? d.reason}</p><p className="text-sm text-muted">{d.customer_name} (customer) and {d.provider_name} (provider) · reported by the {d.opened_by_role} {timeAgo(d.created_at)}</p></div>
              <div className="text-right"><Pill tone="warning">Open</Pill><p className="mt-1 font-extrabold">{formatNaira(d.held_kobo)} held</p></div>
            </div>
            <p className="mt-3 rounded-2xl bg-surface p-3 text-sm">{d.detail}</p>
            <Button className="mt-3 !w-auto !px-6" onClick={() => { setSel(d); setOutcome(""); setNote(""); setErr(""); }}>Decide</Button>
          </Card>
        ))}
      </div>
      {closed.length > 0 && <h2 className="mb-3 mt-8 text-lg font-bold">Resolved</h2>}
      <div className="space-y-2">
        {closed.map((d) => <Card key={d.dispute_id}><p className="font-semibold">{d.service_name}: {OUTCOMES.find((o) => o[0] === d.resolution)?.[1]}</p><p className="text-sm text-muted">{d.resolved_note}</p></Card>)}
      </div>
      <Dialog open={!!sel} onClose={() => setSel(null)} title="Decide this dispute"
        footer={<><Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button><Button loading={resolve.isPending} disabled={!outcome} onClick={() => resolve.mutate()}>Confirm decision</Button></>}>
        <div className="space-y-2">
          {OUTCOMES.map(([v, t, d]) => (
            <label key={v} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${outcome === v ? "border-brand bg-brand-50" : "border-line"}`}>
              <input type="radio" name="out" className="mt-1 accent-brand" checked={outcome === v} onChange={() => setOutcome(v)} /><span><b>{t}</b><br /><span className="text-sm text-muted">{d}</span></span>
            </label>
          ))}
        </div>
        <label htmlFor="rn" className="mb-1 mt-4 block text-sm font-semibold">Explanation both people will see</label>
        <textarea id="rn" rows={3} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
      </Dialog>
    </>
  );
}
