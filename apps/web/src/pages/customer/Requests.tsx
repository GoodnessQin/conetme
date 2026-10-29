import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { rpc } from "../../lib/api";
import type { MyRequest } from "../../lib/types";
import { Button, EmptyState, ListSkeleton, PageHeader, Pill } from "../../components/ui";
import { timeAgo, timeLeft } from "../../lib/format";

const STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" }> = {
  open: { label: "Waiting for offers", tone: "neutral" }, offers_received: { label: "Offers in", tone: "success" },
  accepted: { label: "Provider chosen", tone: "brand" }, expired: { label: "Expired", tone: "warning" }, cancelled: { label: "Cancelled", tone: "danger" },
};

export default function Requests() {
  const q = useQuery({ queryKey: ["my-requests"], queryFn: () => rpc<MyRequest[]>("my_requests"), refetchInterval: 10_000 });
  return (
    <>
      <PageHeader title="My requests" subtitle="Everything you have posted, with the offers it has received." />
      {q.isLoading && <ListSkeleton />}
      {q.data?.length === 0 && <EmptyState title="No requests yet" body="Describe a job and verified providers will send you offers." action={<Link to="/customer"><Button>Post a request</Button></Link>} />}
      <div className="space-y-3">
        {q.data?.map((r) => {
          const s = STATUS[r.status] ?? STATUS.open!;
          return (
            <Link key={r.request_id} to={r.job_id ? `/jobs/${r.job_id}` : `/customer/requests/${r.request_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{r.service_name}{r.urgent && <span className="ml-2 text-xs font-bold text-danger">URGENT</span>}</p>
                  <p className="text-sm text-muted">{r.area_name} · posted {timeAgo(r.created_at)}{["open", "offers_received"].includes(r.status) ? ` · ${timeLeft(r.expires_at)}` : ""}</p>
                </div>
                <div className="text-right"><Pill tone={s.tone}>{s.label}</Pill>
                  {r.offers_count > 0 && <p className="mt-1 text-sm text-muted">{r.offers_count} {r.offers_count === 1 ? "offer" : "offers"}{r.best_price_kobo ? ` from ${formatNaira(r.best_price_kobo)}` : ""}</p>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
