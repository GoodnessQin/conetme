import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHECK_LABELS, formatNaira, type CheckType } from "@connectme/shared";
import { supabase } from "../../lib/supabase";
import { messageFrom, rpc } from "../../lib/api";
import { fmtDateTime, timeLeft } from "../../lib/format";
import type { FieldDef, OfferRow } from "../../lib/types";
import { DetailsList } from "../../components/DynamicFields";
import { Alert, Avatar, Button, Card, Dialog, EmptyState, ListSkeleton, PageHeader, Pill, SectionTitle, Stars, useToast, VerifiedBadge } from "../../components/ui";

interface Req {
  id: string; status: string; expires_at: string | null; urgent: boolean; time_slot: string | null; budget_kobo: number | null;
  details: Record<string, unknown>; created_at: string; services: { name: string; slug: string; form_schema: FieldDef[]; pricing_mode: string; inspection_fee_kobo: number };
  areas: { name: string } | null;
}
type Sort = "match" | "price" | "rating" | "near";

export default function RequestDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [sort, setSort] = useState<Sort>("match");
  const [picked, setPicked] = useState<OfferRow | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [err, setErr] = useState("");

  const req = useQuery({
    queryKey: ["request", id], refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase.from("requests")
        .select("id,status,expires_at,urgent,time_slot,budget_kobo,details,created_at,services(name,slug,form_schema,pricing_mode,inspection_fee_kobo),areas(name)").eq("id", id).single();
      if (error) throw error;
      return data as unknown as Req;
    },
  });
  const open = req.data && ["open", "offers_received"].includes(req.data.status) && (!req.data.expires_at || new Date(req.data.expires_at) > new Date());
  const offers = useQuery({ queryKey: ["offers", id], refetchInterval: open ? 5000 : false, queryFn: () => rpc<OfferRow[]>("request_offers", { p_request: id }) });
  const notified = useQuery({ queryKey: ["notified", id], queryFn: () => rpc<number>("request_notified_count", { p_request: id }) });

  const accept = useMutation({
    mutationFn: (offerId: string) => rpc<string>("accept_offer", { p_offer: offerId }),
    onSuccess: (jobId) => { qc.invalidateQueries({ queryKey: ["my-requests"] }); toast("Offer accepted. Complete payment to confirm the booking."); nav(`/jobs/${jobId}`, { replace: true }); },
    onError: (e) => { setErr(messageFrom(e)); setPicked(null); offers.refetch(); },
  });
  const cancel = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("requests").update({ status: "cancelled" }).eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-requests"] }); toast("Request cancelled."); nav("/customer/requests"); },
    onError: (e) => { setErr(messageFrom(e)); setCancelOpen(false); },
  });

  if (req.isLoading) return <ListSkeleton />;
  if (!req.data) return <EmptyState title="Request not found" body="It may have been removed, or it belongs to another account." action={<Link to="/customer"><Button>Back to home</Button></Link>} />;
  const r = req.data;
  const list = [...(offers.data ?? [])].sort((a, b) =>
    sort === "price" ? a.price_kobo - b.price_kobo : sort === "rating" ? b.rating_avg - a.rating_avg : sort === "near" ? (a.distance_km ?? 99) - (b.distance_km ?? 99) : b.match_score - a.match_score);
  const bestId = [...(offers.data ?? [])].sort((a, b) => b.match_score - a.match_score)[0]?.offer_id;
  const expired = !open && ["open", "offers_received"].includes(r.status);
  const isQuote = r.services.pricing_mode === "quote";

  return (
    <>
      <PageHeader back={{ to: "/customer/requests", label: "My requests" }} title={r.services.name}
        subtitle={`${r.areas?.name ?? ""} · ${r.urgent ? "As soon as possible" : fmtDateTime(r.time_slot)}`}
        actions={open ? <Pill tone="neutral">{timeLeft(r.expires_at)}</Pill> : <Pill tone={r.status === "accepted" ? "brand" : "warning"}>{expired ? "Expired" : r.status === "accepted" ? "Provider chosen" : "Closed"}</Pill>} />
      {err && <div className="mb-4"><Alert tone="danger" title="Action not completed">{err}</Alert></div>}

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div>
          <SectionTitle aside={list.length > 1 && (
            <select aria-label="Sort offers" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold">
              <option value="match">Best match</option><option value="price">Lowest price</option><option value="rating">Highest rated</option><option value="near">Nearest</option>
            </select>)}>
            {list.length ? `${list.length} ${list.length === 1 ? "offer" : "offers"}` : "Offers"}
          </SectionTitle>

          {offers.isLoading && <ListSkeleton rows={2} />}
          {!offers.isLoading && list.length === 0 && (
            (notified.data ?? 0) > 0 ? (
              <EmptyState title="Waiting for offers" body={`${notified.data} verified ${notified.data === 1 ? "provider has" : "providers have"} been alerted. Most offers arrive within the first hour. This page updates by itself.`} />
            ) : (
              <EmptyState title="No verified providers are available in this area yet" body="No approved provider covers this area for the chosen time. Try an adjacent area, or schedule for tomorrow when more providers are free." action={<Link to={`/customer/new/${r.services.slug}`}><Button variant="ghost">Post a new request</Button></Link>} />
            )
          )}

          <div className="space-y-4">
            {list.map((o) => (
              <Card key={o.offer_id} className={o.offer_id === bestId && list.length > 1 ? "border-2 border-brand" : ""}>
                {o.offer_id === bestId && list.length > 1 && <div className="mb-3"><Pill tone="brand">Best match</Pill></div>}
                <div className="flex items-start gap-3">
                  <Avatar name={o.display_name} path={o.avatar_path} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold leading-tight">{o.display_name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><VerifiedBadge level={o.level} /><Stars value={o.rating_avg} count={o.rating_count} /></div>
                    <p className="mt-1 text-sm text-muted">{o.jobs_completed} jobs completed{o.years_experience ? ` · ${o.years_experience} years experience` : ""}{o.distance_km != null ? ` · ${o.distance_km} km away` : ""}</p>
                  </div>
                  <div className="text-right"><p className="text-2xl font-extrabold">{formatNaira(o.price_kobo)}</p>
                    <p className="text-xs text-muted">{isQuote ? "inspection fee" : "total price"}</p></div>
                </div>
                {o.message && <p className="mt-3 rounded-2xl bg-surface p-3 text-sm">“{o.message}”</p>}
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {o.badges.map((b) => <li key={b}><Pill tone="success">✓ {CHECK_LABELS[b as CheckType]?.badge ?? b}</Pill></li>)}
                </ul>
                <p className="mt-3 text-sm text-muted">{o.start_at ? `Can start ${fmtDateTime(o.start_at)}` : "Start time to be agreed"}</p>
                <div className="mt-4 flex gap-3">
                  <Link to={`/customer/providers/${o.provider_id}`} className="btn btn-ghost">View profile</Link>
                  <Button disabled={!open} onClick={() => { setErr(""); setPicked(o); }}>Accept offer</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <Card><SectionTitle>Your request</SectionTitle><DetailsList schema={r.services.form_schema} details={r.details} />
            {r.budget_kobo && <p className="mt-2 text-sm"><span className="text-muted">Your budget: </span><b>{formatNaira(r.budget_kobo)}</b></p>}</Card>
          <Alert title="Your details are protected">Providers cannot see your name, phone number or address until you accept an offer and pay.</Alert>
          {open && <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel this request</Button>}
        </aside>
      </div>

      <Dialog open={!!picked} onClose={() => setPicked(null)} title={`Accept ${picked?.display_name.split(" ")[0]}’s offer?`}
        footer={<><Button variant="ghost" onClick={() => setPicked(null)}>Keep comparing</Button><Button loading={accept.isPending} onClick={() => picked && accept.mutate(picked.offer_id)}>Accept and continue</Button></>}>
        {picked && <>
          <p className="text-3xl font-extrabold">{formatNaira(picked.price_kobo)}</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink/80">
            <li>All other offers close. Those providers are told you chose someone else.</li>
            <li>{isQuote ? "You pay the site inspection fee next. After the visit, the provider sends a full quote that you can accept or decline." : "You pay next. ConnectMe holds the money and releases it to the provider only after you confirm the work."}</li>
            <li>Your address is shared with {picked.display_name.split(" ")[0]} after payment, and you receive a door code to confirm who arrives.</li>
          </ul>
        </>}
      </Dialog>
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this request?"
        footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep it open</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel request</Button></>}>
        <p className="text-sm text-ink/80">Providers who already sent offers will no longer be able to win this job. Nothing has been charged.</p>
      </Dialog>
    </>
  );
}
