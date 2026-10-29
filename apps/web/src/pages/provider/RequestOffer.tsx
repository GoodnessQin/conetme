import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira, splitCommission } from "@connectme/shared";
import { supabase } from "../../lib/supabase";
import { messageFrom, rpc } from "../../lib/api";
import { useCommissionBps, useMyProvider, useServices } from "../../lib/queries";
import { defaultSlot, fmtDateTime, timeLeft } from "../../lib/format";
import type { InboxRow } from "../../lib/types";
import { DetailsList } from "../../components/DynamicFields";
import { Alert, Button, Card, EmptyState, Field, KeyValue, ListSkeleton, PageHeader, Pill, SectionTitle, useToast } from "../../components/ui";

export default function RequestOffer() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const bps = useCommissionBps();
  const prov = useMyProvider();
  const services = useServices().data ?? [];
  const inbox = useQuery({ queryKey: ["provider-inbox"], queryFn: () => rpc<InboxRow[]>("provider_inbox"), refetchInterval: 10_000 });
  const r = inbox.data?.find((x) => x.request_id === id);
  const [price, setPrice] = useState(""); const [start, setStart] = useState(defaultSlot(24)); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      const kobo = Math.round(Number(price) * 100);
      const { error } = await supabase.from("offers").insert({ request_id: id, provider_id: prov.data!.id, price_kobo: kobo, start_at: new Date(start).toISOString(), message: msg.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["provider-inbox"] }); toast("Offer sent. You will be alerted if the customer accepts."); setErr(""); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const withdraw = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("offers").update({ status: "withdrawn" }).eq("id", r!.my_offer_id!); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["provider-inbox"] }); toast("Offer withdrawn."); },
    onError: (e) => setErr(messageFrom(e)),
  });

  if (inbox.isLoading || prov.isLoading) return <ListSkeleton />;
  if (!r) return <EmptyState title="Request not found" body="It may have closed, or it was not sent to you." action={<Link to="/provider/requests" className="btn btn-ghost">Back to requests</Link>} />;
  const schema = services.find((s) => s.slug === r.service_slug)?.form_schema ?? [];
  const isOpen = ["open", "offers_received"].includes(r.request_status);
  const naira = Number(price);
  const kobo = Math.round(naira * 100);
  const split = naira >= 500 ? splitCommission(kobo, bps) : null;
  const quote = r.service_slug === "solar-installer";

  function submit() {
    setErr("");
    if (!(naira >= 500)) return setErr("Enter your price in naira. The minimum offer is ₦500.");
    if (new Date(start).getTime() < Date.now() - 60_000) return setErr("Choose a start time in the future.");
    send.mutate();
  }

  return (
    <>
      <PageHeader back={{ to: "/provider/requests", label: "Requests" }} title={r.service_name} subtitle={`${r.area_name}${r.distance_km != null ? ` · ${r.distance_km} km from you` : ""}`}
        actions={isOpen ? <Pill tone="neutral">{timeLeft(r.expires_at)}</Pill> : <Pill tone="warning">Closed</Pill>} />
      <div className="grid gap-6 md:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card><SectionTitle>The job</SectionTitle><DetailsList schema={schema} details={r.details} />
            <KeyValue items={[["When", r.urgent ? "As soon as possible" : fmtDateTime(r.time_slot)], ["Customer budget", r.budget_kobo ? formatNaira(r.budget_kobo) : "Not stated"]]} /></Card>
          <Alert title="Customer details are private">The customer’s name, phone number and exact address are shared only after they accept your offer and pay. Never ask for contact details in your message.</Alert>
        </div>

        <Card>
          {r.job_id ? (
            <><SectionTitle>Offer accepted</SectionTitle><p className="mb-4 text-sm text-muted">The customer chose you. Open the job to see payment status and details.</p><Link to={`/jobs/${r.job_id}`} className="btn">Open job</Link></>
          ) : r.my_offer_id ? (
            <>
              <SectionTitle>Your offer</SectionTitle>
              <p className="text-3xl font-extrabold">{formatNaira(r.my_offer_price_kobo ?? 0)}</p>
              <p className="mt-1 text-sm text-muted">{r.my_offer_status === "sent" ? "Sent. The customer is comparing offers." : r.my_offer_status === "rejected" ? "The customer chose another provider." : "You withdrew this offer."}</p>
              {r.my_offer_status === "sent" && isOpen && <Button variant="ghost" className="mt-4" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw offer</Button>}
            </>
          ) : !isOpen ? (
            <Alert tone="warning" title="This request has closed">The customer chose a provider, cancelled, or the request expired.</Alert>
          ) : (
            <>
              <SectionTitle>Send your offer</SectionTitle>
              <Field label={quote ? "Your site inspection fee (₦)" : "Your total price (₦)"} htmlFor="price" hint={quote ? "Customers pay this to book the inspection. After the visit you send a full quote." : "Include labour, parts and transport. This is the price the customer pays."}>
                <input id="price" className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder="15000" />
              </Field>
              {split && <div className="-mt-1 mb-4 rounded-2xl bg-surface p-3 text-sm"><div className="flex justify-between"><span className="text-muted">ConnectMe fee ({bps / 100}%)</span><b>{formatNaira(split.commission)}</b></div><div className="mt-1 flex justify-between"><span className="text-muted">You receive</span><b className="text-success">{formatNaira(split.payout)}</b></div></div>}
              <Field label="Earliest you can start" htmlFor="start"><input id="start" type="datetime-local" className="input" value={start} min={defaultSlot(0)} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="Message to the customer (optional)" htmlFor="msg" hint={`${msg.length}/300. Say what is included and what you will bring. No phone numbers.`}>
                <textarea id="msg" rows={3} maxLength={300} className="input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="I can be there at 9am with the replacement valve and fittings. Price includes labour and testing." />
              </Field>
              {err && <div className="mb-3"><Alert tone="danger" title="Offer not sent">{err}</Alert></div>}
              <Button loading={send.isPending} onClick={submit}>Send offer</Button>
              <p className="mt-2 text-center text-xs text-muted">You can withdraw until the customer accepts.</p>
            </>
          )}
          {err && (r.my_offer_id || r.job_id) && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
        </Card>
      </div>
    </>
  );
}
