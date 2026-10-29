import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { timeAgo } from "../lib/format";
import type { NotificationRow } from "../lib/types";
import { EmptyState, ListSkeleton, PageHeader } from "../components/ui";

function describe(n: NotificationRow): { title: string; body: string; to?: string } {
  const p = n.payload as Record<string, string | undefined>;
  switch (n.type) {
    case "new_request": return { title: `New ${p.service ?? "job"} request near you`, body: "Review the details and send your price before another provider does.", to: `/provider/requests/${p.request_id}` };
    case "offer_received": return { title: "You have a new offer", body: "A verified provider has sent you a price. Compare it with the others.", to: `/customer/requests/${p.request_id}` };
    case "offer_accepted": return { title: "A customer accepted your offer", body: "Payment is the next step. Their address unlocks once payment is held.", to: `/jobs/${p.job_id}` };
    case "offer_not_selected": return { title: "The customer chose another provider", body: "No action needed. Keep your availability on to receive new requests." };
    case "job_paid": return { title: "Payment is held. The job is confirmed", body: "You can now see the address. Arrive on time and ask for the customer’s door code.", to: `/jobs/${p.job_id}` };
    case "job_update": return { title: `${p.provider ?? "Your provider"}: ${({ on_the_way: "on the way", arrived: "arrived", working: "work started", completed_by_provider: "work complete. Please confirm" } as Record<string, string>)[p.status ?? ""] ?? "update"}`, body: p.status === "completed_by_provider" ? "Check the work, then confirm to release payment and rate your provider." : "Open the job to follow progress.", to: `/jobs/${p.job_id}` };
    case "payment_released": return { title: "Payment released to you", body: "The customer confirmed the job. Your payout is recorded and will be sent to your bank account.", to: `/jobs/${p.job_id}` };
    case "review_received": return { title: `You received a ${p.stars}-star rating`, body: "Ratings shape your ranking. Open the job to see it.", to: `/jobs/${p.job_id}` };
    case "dispute_opened": return { title: "A problem was reported on a job", body: "Payment stays held while ConnectMe support reviews it. You will be told the outcome.", to: `/jobs/${p.job_id}` };
    case "dispute_resolved": return { title: "A reported problem was resolved", body: p.note ?? "Open the job to see the decision.", to: `/jobs/${p.job_id}` };
    case "new_message": return { title: "New message about your job", body: "Open the job to read and reply.", to: `/jobs/${p.job_id}` };
    case "job_cancelled": return { title: "A job was cancelled", body: "Open the job to see why and what happens to any payment.", to: `/jobs/${p.job_id}` };
    case "auto_confirmed": return { title: "Job confirmed automatically", body: "No problem was reported in time, so payment was released to the provider.", to: `/jobs/${p.job_id}` };
    case "payout_sent": return { title: "Your payout was sent", body: "It will reach your bank account shortly.", to: "/provider/earnings" };
    case "refund_sent": return { title: "Your refund was sent", body: "It returns to your original payment method. Banks can take a few days.", to: `/jobs/${p.job_id}` };
    case "quote_received": return { title: "Your provider sent a quote", body: "Review the full installation quote and accept or decline it.", to: `/jobs/${p.job_id}` };
    case "quote_accepted": return { title: "A customer accepted your quote", body: "The first payment stage is next.", to: `/jobs/${p.job_id}` };
    case "quote_declined": return { title: "A customer declined your quote", body: "You can send a revised quote from the inspection job.", to: `/jobs/${p.job_id}` };
    case "provider_suspended": return { title: "Your provider account is suspended", body: p.reason ?? "Open your dashboard for details.", to: "/provider" };
    case "provider_reinstated": return { title: "Your provider account was reinstated", body: p.reason ?? "You can receive requests again.", to: "/provider" };
    case "provider_approved": return { title: "You are now a Verified Pro", body: "Your application passed every check. Switch on availability to start receiving requests.", to: "/provider" };
    case "provider_needs_info": return { title: "We need more from you", body: p.reason ?? "Open your application to see what to update.", to: "/provider/register" };
    case "provider_rejected": return { title: "Your application was not approved", body: p.reason ?? "Open your dashboard for details.", to: "/provider" };
    default: return { title: "Update", body: "" };
  }
}

export default function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications"], refetchInterval: 15_000,
    queryFn: async () => { const { data, error } = await supabase.from("notifications").select("id,type,payload,read_at,created_at").order("created_at", { ascending: false }).limit(60); if (error) throw error; return data as NotificationRow[]; },
  });
  const markAll = useMutation({
    mutationFn: async () => { await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["unread"] }); },
  });
  useEffect(() => { if (q.data?.some((n) => !n.read_at)) { const t = setTimeout(() => markAll.mutate(), 2500); return () => clearTimeout(t); } }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title="Alerts" subtitle="Requests, offers, payments and verification updates." />
      {q.isLoading && <ListSkeleton />}
      {q.data?.length === 0 && <EmptyState title="Nothing yet" body="Updates about your requests, offers and verification appear here." />}
      <div className="space-y-2">
        {q.data?.map((n) => {
          const d = describe(n);
          const inner = (
            <div className={`flex gap-3 rounded-card border p-4 ${n.read_at ? "border-line bg-white" : "border-brand/40 bg-brand-50"}`}>
              <span className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${n.read_at ? "bg-line" : "bg-brand"}`} />
              <div className="min-w-0 flex-1"><p className="font-bold">{d.title}</p>{d.body && <p className="text-sm text-muted">{d.body}</p>}<p className="mt-1 text-xs text-muted">{timeAgo(n.created_at)}</p></div>
            </div>
          );
          return d.to ? <Link key={n.id} to={d.to} className="block">{inner}</Link> : <div key={n.id}>{inner}</div>;
        })}
      </div>
    </>
  );
}
