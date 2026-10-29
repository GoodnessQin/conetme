import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../../lib/api";
import { fmtDate, fmtDateTime } from "../../lib/format";
import type { Earnings, Progress } from "../../lib/types";
import { Alert, Card, EmptyState, ListSkeleton, PageHeader, Pill, SectionTitle } from "../../components/ui";
import { Link } from "react-router-dom";

const TILES: [keyof Pick<Earnings, "held_kobo" | "payable_kobo" | "paid_kobo">, string, string][] = [
  ["held_kobo", "Held for jobs in progress", "Yours once the customer confirms the work"],
  ["payable_kobo", "On its way to your bank", "Confirmed jobs waiting to be sent"],
  ["paid_kobo", "Paid out", "Sent to your bank account"],
];

export default function ProviderEarnings() {
  const q = useQuery({ queryKey: ["earnings"], refetchInterval: 20_000, queryFn: () => rpc<Earnings | null>("provider_earnings") });
  const prog = useQuery({ queryKey: ["progress"], queryFn: () => rpc<Progress>("my_verification_progress") });
  if (q.isLoading) return <ListSkeleton />;
  const e = q.data;
  if (!e) return <EmptyState title="Earnings start after you are approved" body="Once you complete jobs, your earnings and payouts appear here." />;
  return (
    <>
      <PageHeader title="Earnings" subtitle={prog.data?.bank ? `Payouts go to ${prog.data.bank_name}, account ending ${prog.data.bank_last4}.` : "Add a bank account to be paid."} />
      <div className="grid gap-3 sm:grid-cols-3">
        {TILES.map(([k, t, d]) => <Card key={k}><p className="text-sm text-muted">{t}</p><p className="mt-1 text-2xl font-extrabold">{formatNaira(e[k])}</p><p className="mt-1 text-xs text-muted">{d}</p></Card>)}
      </div>
      {e.failed_kobo > 0 && <div className="mt-4"><Alert tone="danger" title="A payout needs attention">{formatNaira(e.failed_kobo)} could not be sent. Our team has been notified and will retry. Check that your bank account details are correct.</Alert></div>}
      <p className="mt-4 text-sm text-muted">ConnectMe keeps a service fee on each completed job. The amounts above are already after that fee. To change your bank account, contact support so the new account can be verified.</p>

      <div className="mt-8">
        <SectionTitle>Payout history</SectionTitle>
        {e.payouts.length === 0 && <EmptyState title="No payouts yet" body="After a customer confirms a job, your payout appears here." />}
        <div className="space-y-3">
          {e.payouts.map((p) => {
            const status = p.status === "sent" ? { l: "Sent", t: "success" as const } : p.status === "failed" ? { l: "Needs attention", t: "danger" as const } : p.awaiting_approval ? { l: "Under review", t: "warning" as const } : new Date(p.available_at) > new Date() ? { l: `Scheduled ${fmtDate(p.available_at)}`, t: "neutral" as const } : { l: "Sending soon", t: "brand" as const };
            return (
              <Link key={p.id} to={`/jobs/${p.job_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-bold">{p.service}</p><p className="text-sm text-muted">Job value {formatNaira(p.gross_kobo)} · fee {formatNaira(p.commission_kobo)}</p><p className="text-xs text-muted">{p.processed_at ? `Sent ${fmtDateTime(p.processed_at)}` : `Confirmed ${fmtDate(p.created_at)}`}</p></div>
                  <div className="text-right"><p className="font-extrabold">{formatNaira(p.net_kobo)}</p><Pill tone={status.t}>{status.l}</Pill></div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
