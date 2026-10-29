import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../../lib/api";
import type { InboxRow } from "../../lib/types";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "../../components/ui";
import { fmtDateTime, timeAgo, timeLeft } from "../../lib/format";

type Tab = "new" | "offered" | "closed";
export default function ProviderRequests() {
  const [tab, setTab] = useState<Tab>("new");
  const q = useQuery({ queryKey: ["provider-inbox"], refetchInterval: 10_000, queryFn: () => rpc<InboxRow[]>("provider_inbox") });
  const rows = q.data ?? [];
  const isOpen = (r: InboxRow) => ["open", "offers_received"].includes(r.request_status);
  const groups: Record<Tab, InboxRow[]> = {
    new: rows.filter((r) => isOpen(r) && !r.my_offer_id),
    offered: rows.filter((r) => !!r.my_offer_id && (isOpen(r) || r.my_offer_status === "accepted" || r.job_id !== null)),
    closed: rows.filter((r) => (!isOpen(r) && !r.my_offer_id) || r.my_offer_status === "rejected" || r.my_offer_status === "withdrawn"),
  };
  const list = groups[tab];
  return (
    <>
      <PageHeader title="Requests" subtitle="Customers near you who need a verified provider." />
      <div className="mb-4 flex gap-2" role="tablist">
        {([["new", "New"], ["offered", "My offers"], ["closed", "Closed"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line"}`}>{l} ({groups[k].length})</button>
        ))}
      </div>
      {q.isLoading && <ListSkeleton />}
      {!q.isLoading && list.length === 0 && <EmptyState title={tab === "new" ? "No new requests" : tab === "offered" ? "You have not sent any offers yet" : "Nothing closed yet"} body={tab === "new" ? "When a customer within your travel range posts a job for your service, it appears here and you are alerted." : "Offers you send, and their results, appear here."} />}
      <div className="space-y-3">
        {list.map((r) => (
          <Link key={r.request_id} to={r.job_id ? `/jobs/${r.job_id}` : `/provider/requests/${r.request_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold">{r.service_name}{r.urgent && <span className="ml-2 text-xs font-bold text-danger">URGENT</span>}</p>
                <p className="text-sm text-muted">{r.area_name}{r.distance_km != null ? ` · ${r.distance_km} km away` : ""} · {r.urgent ? "As soon as possible" : fmtDateTime(r.time_slot)}</p>
                <p className="text-xs text-muted">Posted {timeAgo(r.created_at)}</p>
              </div>
              <div className="text-right">
                {r.my_offer_price_kobo ? <><p className="font-extrabold">{formatNaira(r.my_offer_price_kobo)}</p><Pill tone={r.my_offer_status === "accepted" ? "success" : r.my_offer_status === "sent" ? "brand" : "neutral"}>{r.my_offer_status === "accepted" ? "Accepted" : r.my_offer_status === "sent" ? "Offer sent" : r.my_offer_status === "rejected" ? "Not chosen" : "Withdrawn"}</Pill></>
                  : <Pill tone="neutral">{isOpen(r) ? timeLeft(r.expires_at) : "Closed"}</Pill>}
                {r.budget_kobo && <p className="mt-1 text-xs text-muted">Budget {formatNaira(r.budget_kobo)}</p>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
