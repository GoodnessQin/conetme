import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { FunctionUnavailable, invokeFn, messageFrom, rpc } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Alert, Button, Card, Dialog, EmptyState, Field, ListSkeleton, PageHeader, Pill, SectionTitle, useToast } from "../../components/ui";

interface Summary {
  mode: string; cash_kobo: number; held_kobo: number; payable_kobo: number; refund_payable_kobo: number; commission_kobo: number; fees_kobo: number;
  checks: { name: string; ledger: number; records: number; ok: boolean }[]; ok: boolean;
  payouts_pending: number; payouts_failed: number; payouts_need_approval: number; refunds_pending: number; webhook_errors: number;
}
interface Payout { payout_id: string; job_id: string; provider_name: string; bank_name: string | null; account_last4: string; account_name: string | null; net_kobo: number; status: string; available_at: string; needs_approval: boolean; approved: boolean; attempts: number; last_error: string | null; transfer_code: string | null; created_at: string; processed_at: string | null }
interface Payment { payment_id: string; reference: string; amount_kobo: number; status: string; provider: string; fee_kobo: number; customer_name: string; service_name: string; created_at: string; paid_at: string | null }
interface Refund { refund_id: string; customer_name: string; amount_kobo: number; reason: string; status: string; attempts: number; last_error: string | null; created_at: string }
interface Entry { entry_id: number; account: string; direction: string; amount_kobo: number; ref_type: string; memo: string | null; created_at: string }
type Tab = "payouts" | "payments" | "refunds" | "ledger";

export default function Finance() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("payouts");
  const [ref, setRef] = useState<Payout | null>(null);
  const [refText, setRefText] = useState(""); const [err, setErr] = useState("");
  const summary = useQuery({ queryKey: ["fin-summary"], refetchInterval: 20_000, queryFn: () => rpc<Summary>("finance_summary") });
  const payouts = useQuery({ queryKey: ["fin-payouts"], enabled: tab === "payouts", queryFn: () => rpc<Payout[]>("finance_payouts") });
  const payments = useQuery({ queryKey: ["fin-payments"], enabled: tab === "payments", queryFn: () => rpc<Payment[]>("finance_payments", { p_limit: 100 }) });
  const refunds = useQuery({ queryKey: ["fin-refunds"], enabled: tab === "refunds", queryFn: () => rpc<Refund[]>("finance_refunds") });
  const ledger = useQuery({ queryKey: ["fin-ledger"], enabled: tab === "ledger", queryFn: () => rpc<Entry[]>("finance_ledger", { p_limit: 120 }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["fin-summary"] }).then(() => { qc.invalidateQueries({ queryKey: ["fin-payouts"] }); qc.invalidateQueries({ queryKey: ["fin-refunds"] }); });

  const run = useMutation({
    mutationFn: async () => {
      if (summary.data?.mode === "paystack") {
        try { return await invokeFn<Record<string, number>>("finance-runner", {}); }
        catch (e) { if (e instanceof FunctionUnavailable) throw new Error("The payout function is not deployed yet. See supabase/functions/README.md."); throw e; }
      }
      return rpc<Record<string, number>>("finance_run_test_payouts");
    },
    onSuccess: (r) => { toast(`Done: ${Object.entries(r).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}.`); refresh(); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const act = useMutation({
    mutationFn: async (a: { fn: string; args: Record<string, unknown> }) => rpc(a.fn, a.args),
    onSuccess: () => { setRef(null); setRefText(""); refresh(); toast("Saved."); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const s = summary.data;
  const tone = (st: string) => (st === "sent" || st === "success" ? "success" : st === "failed" ? "danger" : st === "pending" || st === "initiated" ? "warning" : "neutral") as "success" | "danger" | "warning" | "neutral";

  return (
    <>
      <PageHeader title="Finance" subtitle="Every kobo, where it is, and whether the books balance."
        actions={<Button className="!w-auto !px-6" loading={run.isPending} onClick={() => { setErr(""); run.mutate(); }}>{s?.mode === "paystack" ? "Send due payouts now" : "Complete test payouts"}</Button>} />
      {err && <div className="mb-4"><Alert tone="danger" title="Not completed">{err}</Alert></div>}
      {summary.isLoading && <ListSkeleton rows={2} />}
      {summary.error && <EmptyState title="You do not have access" body="The Finance area is for the finance and admin roles. Ask an admin to grant finance access." />}
      {s && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2"><Pill tone={s.mode === "paystack" ? "success" : "warning"}>{s.mode === "paystack" ? "Live payments" : "Test mode: no real money moves"}</Pill>
            {s.payouts_need_approval > 0 && <Pill tone="warning">{s.payouts_need_approval} payout{s.payouts_need_approval > 1 ? "s" : ""} need approval</Pill>}
            {s.payouts_failed > 0 && <Pill tone="danger">{s.payouts_failed} failed payout{s.payouts_failed > 1 ? "s" : ""}</Pill>}
            {s.webhook_errors > 0 && <Pill tone="danger">{s.webhook_errors} webhook error{s.webhook_errors > 1 ? "s" : ""}</Pill>}</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {([["Cash in the client-funds account", s.cash_kobo], ["Held for customers", s.held_kobo], ["Owed to providers", s.payable_kobo], ["Refunds owed", s.refund_payable_kobo], ["ConnectMe commission earned", s.commission_kobo], ["Processing and transfer fees paid", s.fees_kobo]] as [string, number][]).map(([t, v]) => (
              <Card key={t}><p className="text-xs text-muted">{t}</p><p className="mt-1 text-xl font-extrabold">{formatNaira(v)}</p></Card>
            ))}
          </div>
          <Card className="mt-4">
            <SectionTitle aside={<Pill tone={s.ok ? "success" : "danger"}>{s.ok ? "Books balance" : "Mismatch: investigate"}</Pill>}>Reconciliation</SectionTitle>
            <ul className="divide-y divide-line text-sm">
              {s.checks.map((c) => <li key={c.name} className="flex items-center justify-between gap-3 py-2.5"><span>{c.ok ? "✓" : "✕"} {c.name}</span><span className={c.ok ? "text-muted" : "font-bold text-danger"}>{formatNaira(c.ledger)} vs {formatNaira(c.records)}</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-muted">Also compare Cash above with your real bank or processor balance each day. The ledger cannot see money that moves outside ConnectMe.</p>
          </Card>
        </>
      )}

      <div className="mb-4 mt-8 flex flex-wrap gap-2">
        {(["payouts", "payments", "refunds", "ledger"] as Tab[]).map((k) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${tab === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line"}`}>{k}</button>)}
      </div>

      {tab === "payouts" && (payouts.isLoading ? <ListSkeleton /> : <div className="space-y-3">
        {payouts.data?.length === 0 && <EmptyState title="No payouts yet" body="Payouts are created when customers confirm jobs." />}
        {payouts.data?.map((p) => (
          <Card key={p.payout_id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-bold">{p.provider_name}</p><p className="text-sm text-muted">{p.bank_name ?? "No bank"} ••••{p.account_last4} · {p.account_name ?? ""}</p>
                <p className="text-xs text-muted">{p.status === "sent" ? `Sent ${fmtDateTime(p.processed_at)} (${p.transfer_code})` : `Due ${fmtDateTime(p.available_at)} · attempts ${p.attempts}`}</p>
                {p.last_error && <p className="mt-1 text-xs text-danger">{p.last_error}</p>}</div>
              <div className="text-right"><p className="font-extrabold">{formatNaira(p.net_kobo)}</p><Pill tone={tone(p.status)}>{p.needs_approval && !p.approved && p.status === "pending" ? "Needs approval" : p.status}</Pill></div>
            </div>
            {p.status !== "sent" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {p.needs_approval && !p.approved && p.status === "pending" && <Button className="!w-auto !px-5 !py-2 !text-sm" onClick={() => act.mutate({ fn: "finance_approve_payout", args: { p_payout: p.payout_id } })}>Approve</Button>}
                {p.status === "failed" && <Button variant="ghost" className="!w-auto !px-5 !py-2 !text-sm" onClick={() => act.mutate({ fn: "finance_retry_payout", args: { p_payout: p.payout_id } })}>Retry</Button>}
                <Button variant="soft" className="!w-auto !px-5 !py-2 !text-sm" onClick={() => { setErr(""); setRef(p); }}>Mark paid manually</Button>
              </div>
            )}
          </Card>
        ))}</div>)}

      {tab === "payments" && (payments.isLoading ? <ListSkeleton /> : <div className="space-y-2">{payments.data?.map((p) => (
        <Card key={p.payment_id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{p.service_name} · {p.customer_name}</p><p className="break-all text-xs text-muted">{p.reference} · {p.provider} · fee {formatNaira(p.fee_kobo)}</p><p className="text-xs text-muted">{fmtDateTime(p.paid_at ?? p.created_at)}</p></div>
          <div className="text-right"><p className="font-extrabold">{formatNaira(p.amount_kobo)}</p><Pill tone={tone(p.status)}>{p.status}</Pill></div></div></Card>))}</div>)}

      {tab === "refunds" && (refunds.isLoading ? <ListSkeleton /> : <div className="space-y-2">
        {refunds.data?.length === 0 && <EmptyState title="No refunds" body="Cancellations and dispute refunds appear here." />}
        {refunds.data?.map((r) => <Card key={r.refund_id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{r.customer_name}</p><p className="text-sm text-muted">{r.reason}</p>{r.last_error && <p className="text-xs text-danger">{r.last_error}</p>}</div><div className="text-right"><p className="font-extrabold">{formatNaira(r.amount_kobo)}</p><Pill tone={tone(r.status)}>{r.status}</Pill></div></div></Card>)}</div>)}

      {tab === "ledger" && (ledger.isLoading ? <ListSkeleton /> : <Card><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="text-xs text-muted"><th className="py-2">When</th><th>Account</th><th>Debit</th><th>Credit</th><th>Type</th></tr></thead>
        <tbody className="divide-y divide-line">{ledger.data?.map((l) => <tr key={l.entry_id}><td className="py-2 text-xs">{fmtDateTime(l.created_at)}</td><td>{l.account}</td><td>{l.direction === "debit" ? formatNaira(l.amount_kobo) : ""}</td><td>{l.direction === "credit" ? formatNaira(l.amount_kobo) : ""}</td><td className="text-xs text-muted">{l.ref_type}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-muted">The ledger is append-only: entries can never be edited or deleted.</p></Card>)}

      <Dialog open={!!ref} onClose={() => setRef(null)} title="Mark this payout as paid"
        footer={<><Button variant="ghost" onClick={() => setRef(null)}>Cancel</Button><Button loading={act.isPending} onClick={() => ref && act.mutate({ fn: "finance_mark_payout_sent", args: { p_payout: ref.payout_id, p_reference: refText } })}>Confirm paid</Button></>}>
        <p className="mb-3 text-sm text-muted">Use this only after sending {ref ? formatNaira(ref.net_kobo) : ""} to {ref?.provider_name} by bank transfer yourself. It is recorded in the audit log.</p>
        <Field label="Bank transfer reference" htmlFor="br"><input id="br" className="input" value={refText} onChange={(e) => setRefText(e.target.value)} /></Field>
        {err && <Alert tone="danger">{err}</Alert>}
      </Dialog>
    </>
  );
}
