import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHECK_LABELS, formatNaira, type CheckType } from "@connectme/shared";
import { invokeFn, messageFrom, rpc } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { usePaymentMode, useServices, useTestPayments } from "../lib/queries";
import type { JobView } from "../lib/types";
import { DetailsList } from "../components/DynamicFields";
import { MapPicker, mapsLinks } from "../components/MapPicker";
import { ChatCard, QuoteCard } from "../components/JobExtras";
import { Alert, Avatar, Button, Card, Dialog, EmptyState, KeyValue, ListSkeleton, PageHeader, Pill, SectionTitle, Stars, useToast, VerifiedBadge } from "../components/ui";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";
export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_payment: { label: "Awaiting payment", tone: "warning" }, paid_held: { label: "Paid and held", tone: "brand" },
  on_the_way: { label: "On the way", tone: "brand" }, arrived: { label: "Arrived", tone: "brand" }, working: { label: "Work in progress", tone: "brand" },
  completed_by_provider: { label: "Awaiting confirmation", tone: "warning" }, confirmed: { label: "Confirmed", tone: "success" }, paid_out: { label: "Complete", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" }, disputed: { label: "Under review", tone: "warning" }, refunded: { label: "Refunded", tone: "neutral" }, split_resolved: { label: "Resolved", tone: "neutral" },
};
const STAGES = ["Booked", "Paid", "On the way", "Working", "Done", "Confirmed"];
const STAGE_OF: Record<string, number> = { awaiting_payment: 0, paid_held: 1, on_the_way: 2, arrived: 2, working: 3, completed_by_provider: 4, confirmed: 5, paid_out: 5 };
const REASONS = [["poor_work", "The work was poor or incomplete"], ["no_show", "The other person did not show up"], ["price_changed", "The price was changed"], ["damage", "Something was damaged"], ["safety", "I felt unsafe"], ["other", "Something else"]] as const;
const ACTIVE = ["paid_held", "on_the_way", "arrived", "working", "completed_by_provider"];

function RatingCard({ jobId, mine, who, onDone }: { jobId: string; mine: { stars: number; comment: string | null } | null; who: string; onDone: () => void }) {
  const toast = useToast();
  const [stars, setStars] = useState(0); const [comment, setComment] = useState(""); const [err, setErr] = useState("");
  const send = useMutation({ mutationFn: () => rpc("submit_review", { p_job: jobId, p_stars: stars, p_comment: comment }), onSuccess: () => { toast("Thank you. Your rating is saved."); onDone(); }, onError: (e) => setErr(messageFrom(e)) });
  if (mine) return <Card><SectionTitle>Your rating</SectionTitle><p className="text-xl text-amber-500" aria-label={`${mine.stars} out of 5`}>{"★".repeat(mine.stars)}<span className="text-line">{"★".repeat(5 - mine.stars)}</span></p>{mine.comment && <p className="mt-1 text-sm">{mine.comment}</p>}</Card>;
  return (
    <Card className="border-2 border-lime">
      <SectionTitle>How was it with {who}?</SectionTitle>
      <div className="mb-3 flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setStars(n)} className={`text-4xl leading-none ${n <= stars ? "text-amber-500" : "text-line"}`}>★</button>)}
      </div>
      <textarea aria-label="Comment" rows={3} className="input" maxLength={400} placeholder="What went well, or what could be better? No phone numbers." value={comment} onChange={(e) => setComment(e.target.value)} />
      {err && <div className="mt-2"><Alert tone="danger">{err}</Alert></div>}
      <Button className="mt-3" disabled={!stars} loading={send.isPending} onClick={() => { setErr(""); send.mutate(); }}>Submit rating</Button>
    </Card>
  );
}

export default function JobDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const testPayments = useTestPayments();
  const services = useServices().data ?? [];
  const [err, setErr] = useState("");
  const [dlg, setDlg] = useState<null | "confirm" | "problem" | "code" | "cancel">(null);
  const mode = usePaymentMode();
  const [cancelWhy, setCancelWhy] = useState("");
  const [reason, setReason] = useState<string>("poor_work"); const [detail, setDetail] = useState(""); const [code, setCode] = useState(""); const [dErr, setDErr] = useState("");

  const q = useQuery({ queryKey: ["job", id], refetchInterval: 6000, queryFn: () => rpc<JobView | null>("job_view", { p_job: id }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["job", id] }); qc.invalidateQueries({ queryKey: ["my-jobs"] }); qc.invalidateQueries({ queryKey: ["my-providers"] }); };
  const onErr = (e: unknown) => { setErr(messageFrom(e)); setDlg(null); };
  const pay = useMutation({
    mutationFn: async () => {
      if (mode === "paystack") { const r = await invokeFn<{ authorization_url: string }>("paystack-init", { job_id: id }); window.location.href = r.authorization_url; return; }
      await rpc<void>("test_pay_next_milestone", { p_job: id });
    },
    onSuccess: () => { if (mode !== "paystack") { refresh(); toast("Payment recorded in test mode."); } },
    onError: onErr,
  });
  const cancelJob = useMutation({ mutationFn: () => rpc<void>("cancel_job", { p_job: id, p_reason: cancelWhy }), onSuccess: () => { setDlg(null); setCancelWhy(""); refresh(); toast("Job cancelled."); }, onError: (e) => { setDErr(messageFrom(e)); } });
  const confirm = useMutation({ mutationFn: () => rpc<void>("customer_confirm_job", { p_job: id }), onSuccess: () => { setDlg(null); refresh(); toast("Payment released. Please rate your provider."); }, onError: onErr });
  const advance = useMutation({
    mutationFn: ({ to, c }: { to: string; c?: string }) => rpc<string>("provider_advance_job", { p_job: id, p_to: to, p_code: c ?? null }),
    onSuccess: (res, v) => {
      if (res === "wrong_code") return setDErr("That code is not right. Ask the customer to read it from their ConnectMe job page.");
      if (res === "locked") return setDErr("Too many wrong codes. Contact ConnectMe support before continuing.");
      setDlg(null); setCode(""); setDErr(""); refresh(); toast(v.to === "completed_by_provider" ? "Marked complete. The customer will be asked to confirm." : "Updated.");
    },
    onError: onErr,
  });
  const dispute = useMutation({ mutationFn: () => rpc<void>("open_dispute", { p_job: id, p_reason: reason, p_detail: detail }), onSuccess: () => { setDlg(null); setDetail(""); refresh(); toast("Reported. Payment stays held while support reviews."); }, onError: (e) => setDErr(messageFrom(e)) });

  if (q.isLoading) return <ListSkeleton />;
  const v = q.data;
  if (!v) return <EmptyState title="Job not found" body="It may belong to another account." action={<Link to="/app"><Button>Back to home</Button></Link>} />;
  const isCust = v.role === "customer";
  const status = v.job.status;
  const st = JOB_STATUS[status] ?? { label: status, tone: "neutral" as const };
  const stage = STAGE_OF[status] ?? 0;
  const paid = !["awaiting_payment", "cancelled"].includes(status);
  const nextDue = v.milestones.find((m) => m.status === "pending");
  const schema = services.find((s) => s.slug === v.service.slug)?.form_schema ?? [];
  const otherName = isCust ? v.provider?.name.split(" ")[0] ?? "your provider" : v.customer?.first_name ?? "the customer";
  const links = v.location ? mapsLinks(v.location) : null;
  const canReport = ACTIVE.includes(status);

  const shareText = `I have booked ${v.provider?.name} (${v.service.name}) through ConnectMe${v.address ? ` at ${v.address}` : ""}${v.request.time_slot ? `, ${fmtDateTime(v.request.time_slot)}` : ""}.`;
  async function share() {
    try { if (navigator.share) await navigator.share({ title: "My ConnectMe booking", text: shareText }); else { await navigator.clipboard.writeText(shareText); toast("Booking details copied. Send them to someone you trust."); } } catch { /* cancelled */ }
  }

  const providerAction: Record<string, { label: string; to: string; hint: string }> = {
    paid_held: { label: "I’m on my way", to: "on_the_way", hint: "Payment is held. Head to the address now." },
    on_the_way: { label: "I’ve arrived", to: "arrived", hint: "Tap when you reach the address." },
    arrived: { label: "Start work", to: "working", hint: "Ask the customer for their 4-digit door code, then enter it to start." },
    working: { label: "Mark work complete", to: "completed_by_provider", hint: "Tap when the job is finished. The customer then confirms and you are paid." },
  };
  const pa = providerAction[status];

  return (
    <>
      <PageHeader back={{ to: isCust ? "/customer/jobs" : "/provider/jobs", label: "Jobs" }} title={v.service.name}
        subtitle={`${v.request.area ?? ""} · Booked ${fmtDateTime(v.job.created_at)}`} actions={<Pill tone={st.tone}>{st.label}</Pill>} />
      {err && <div className="mb-4"><Alert tone="danger" title="Could not complete that">{err}</Alert></div>}
      {v.dispute && (
        <div className="mb-4"><Alert tone={v.dispute.status === "open" ? "warning" : "info"} title={v.dispute.status === "open" ? "A problem has been reported" : "Problem resolved"}>
          {v.dispute.status === "open" ? "Payment stays held while ConnectMe support reviews. You will be told the outcome here and in Alerts." : `${({ refund_customer: "The customer was refunded.", pay_provider: "The provider was paid.", split_50_50: "The payment was split 50/50." } as Record<string, string>)[v.dispute.resolution ?? ""] ?? ""} ${v.dispute.note ?? ""}`}
        </Alert></div>
      )}

      {paid && stage <= 5 && !["disputed", "refunded", "split_resolved"].includes(status) && (
        <Card className="mb-6">
          <ol className="grid grid-cols-6 gap-1" aria-label="Job progress">
            {STAGES.map((s, i) => <li key={s} aria-current={i === stage ? "step" : undefined} className="text-center"><div className={`mx-auto mb-1.5 h-1.5 rounded-full ${i <= stage ? "bg-brand" : "bg-line"}`} /><span className={`text-[10px] font-semibold leading-tight md:text-xs ${i <= stage ? "text-ink" : "text-muted"}`}>{s}</span></li>)}
          </ol>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* ---------- customer: pay ---------- */}
          {isCust && status === "awaiting_payment" && (
            <Card className="border-2 border-brand">
              <SectionTitle>Pay to confirm your booking</SectionTitle>
              <p className="mb-3 text-sm text-muted">ConnectMe holds your payment. {v.service.pricing_mode === "quote" ? "The inspection fee is released to the provider after you confirm the visit." : "It is released to the provider only after you confirm the work is done."}</p>
              <KeyValue items={[...v.milestones.map((m): [string, string] => [m.label, formatNaira(m.amount_kobo)]), ["Total", formatNaira(v.job.total_kobo)]]} />
              {mode === "paystack" ? (
                <Button className="mt-4" loading={pay.isPending} onClick={() => { setErr(""); pay.mutate(); }}>Pay {nextDue ? formatNaira(nextDue.amount_kobo) : ""} securely</Button>
              ) : testPayments ? (<>
                <div className="my-4"><Alert tone="warning" title="Test mode">No real money moves. This button simulates a successful payment so you can test the full flow.</Alert></div>
                <Button loading={pay.isPending} onClick={() => { setErr(""); pay.mutate(); }}>Pay {nextDue ? formatNaira(nextDue.amount_kobo) : ""} (test mode)</Button></>
              ) : <div className="mt-4"><Alert>Secure online payment is being connected. You will be able to pay here shortly.</Alert></div>}
            </Card>
          )}
          {isCust && ACTIVE.includes(status) && nextDue && (
            <Card><SectionTitle>Next payment: {nextDue.label}</SectionTitle><p className="mb-3 text-sm text-muted">{formatNaira(nextDue.amount_kobo)} is still to pay. It must be paid before you can confirm the job.</p>
              {(mode === "paystack" || testPayments) && <Button variant="ghost" loading={pay.isPending} onClick={() => { setErr(""); pay.mutate(); }}>Pay {formatNaira(nextDue.amount_kobo)}{mode === "paystack" ? " securely" : " (test mode)"}</Button>}</Card>
          )}

          {/* ---------- customer: door code ---------- */}
          {isCust && ACTIVE.includes(status) && v.door_code && (
            <Card>
              <SectionTitle>Door code</SectionTitle>
              <div className="flex justify-center gap-2" aria-label={`Door code ${v.door_code.split("").join(" ")}`}>{v.door_code.split("").map((d, i) => <span key={i} className="grid h-16 w-14 place-items-center rounded-2xl bg-lime text-3xl font-extrabold">{d}</span>)}</div>
              <p className="mt-3 text-center text-sm text-muted">When {otherName} arrives, they must ask you for this code before starting. If they do not ask, or the person is not the one shown on this page, do not let them in and contact ConnectMe support.</p>
            </Card>
          )}

          {/* ---------- customer: confirm ---------- */}
          {isCust && status === "completed_by_provider" && (
            <Card className="border-2 border-brand">
              <SectionTitle>{otherName} says the work is done</SectionTitle>
              <p className="mb-4 text-sm text-muted">Check the work. If you are happy, confirm and ConnectMe releases the payment. If something is wrong, report it and the payment stays held.</p>
              <Button disabled={!!nextDue} onClick={() => setDlg("confirm")}>Confirm and release payment</Button>
              {nextDue && <p className="mt-2 text-xs text-danger">Pay the remaining {formatNaira(nextDue.amount_kobo)} first.</p>}
              <Button variant="ghost" className="mt-3" onClick={() => { setDErr(""); setDlg("problem"); }}>Report a problem</Button>
            </Card>
          )}

          {/* ---------- provider: next step ---------- */}
          {!isCust && v.role === "provider" && status === "awaiting_payment" && <Alert title="Waiting for the customer to pay">You will be alerted as soon as payment is held. The address unlocks then.</Alert>}
          {!isCust && v.role === "provider" && pa && (
            <Card className="border-2 border-brand">
              <SectionTitle>Your next step</SectionTitle><p className="mb-3 text-sm text-muted">{pa.hint}</p>
              <Button loading={advance.isPending && dlg !== "code"} onClick={() => { setErr(""); setDErr(""); if (pa.to === "working") setDlg("code"); else advance.mutate({ to: pa.to }); }}>{pa.label}</Button>
            </Card>
          )}
          {!isCust && v.role === "provider" && status === "completed_by_provider" && <Alert title="Waiting for the customer to confirm">Once they confirm, your payment of {formatNaira(v.payout_kobo ?? 0)} is released.</Alert>}
          {!isCust && v.role === "provider" && status === "paid_out" && <Alert tone="success" title="Payment released">{formatNaira(v.payout_kobo ?? 0)} is on its way to your verified bank account. Track it under Earnings.</Alert>}

          {/* ---------- location ---------- */}
          {paid && v.address && (
            <Card>
              <SectionTitle>{isCust ? "Job location" : "Where to go"}</SectionTitle>
              <p className="mb-3 font-semibold">{v.address}</p>
              {v.location && <MapPicker center={v.location} value={v.location} readOnly height={220} />}
              {links && !isCust && <div className="mt-3 grid grid-cols-2 gap-2"><a href={links.directions} target="_blank" rel="noreferrer" className="btn !py-2.5 !text-sm">Get directions</a><a href={links.view} target="_blank" rel="noreferrer" className="btn btn-ghost !py-2.5 !text-sm">Open in Maps</a></div>}
              {!isCust && v.customer && <p className="mt-3 text-sm text-muted">Customer: {v.customer.first_name}. Use the chat below. Never ask for the customer’s number: all contact stays on ConnectMe.</p>}
            </Card>
          )}

          {paid && status !== "cancelled" && v.role !== "staff" && <ChatCard jobId={id} otherName={otherName} />}
          {status === "paid_out" && <QuoteCard jobId={id} isCustomer={isCust} onChanged={refresh} />}

          {/* ---------- rating ---------- */}
          {status === "paid_out" && <RatingCard jobId={id} mine={v.my_review} who={otherName} onDone={refresh} />}
          {isCust && status === "paid_out" && v.provider && (
            <Button variant="ghost" onClick={() => nav(`/customer/new/${v.service.slug}`, { state: { preferred: { id: v.provider!.id, name: v.provider!.name } } })}>Book {otherName} again</Button>
          )}

          <Card><SectionTitle>The job</SectionTitle><DetailsList schema={schema} details={v.request.details} />
            {v.offer?.message && <p className="mt-3 rounded-2xl bg-surface p-3 text-sm"><b>{isCust ? "Provider’s message: " : "Your message: "}</b>{v.offer.message}</p>}
            {v.offer?.start_at && <p className="mt-2 text-sm text-muted">Agreed start: {fmtDateTime(v.offer.start_at)}</p>}</Card>

          <Card><SectionTitle>Activity</SectionTitle>
            <ol className="space-y-3">{[...v.events].reverse().map((e, i) => <li key={i} className="flex gap-3 text-sm"><span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-brand" /><div><p className="font-semibold">{e.note ?? e.event}</p><p className="text-xs text-muted">{fmtDateTime(e.at)}</p></div></li>)}</ol>
          </Card>
        </div>

        <aside className="space-y-4">
          {isCust && v.provider && (
            <Card>
              <div className="flex items-center gap-3"><Avatar name={v.provider.name} path={v.provider.avatar} size={56} /><div><p className="font-bold leading-tight">{v.provider.name}</p><VerifiedBadge level={v.provider.level} /></div></div>
              <div className="mt-2"><Stars value={v.provider.rating} count={v.provider.rating_count} /></div>
              <ul className="mt-3 space-y-1.5">{v.provider.badges.map((b) => <li key={b} className="text-sm"><span className="text-success">✓</span> {CHECK_LABELS[b as CheckType]?.badge ?? b}</li>)}</ul>
              <Link to={`/customer/providers/${v.provider.id}`} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">View full profile</Link>
            </Card>
          )}
          <Card><SectionTitle>Payment</SectionTitle>
            <KeyValue items={isCust
              ? [...v.milestones.map((m): [string, ReactNode] => [m.label, <span key={m.id}>{formatNaira(m.amount_kobo)} <Pill tone={m.status === "pending" ? "warning" : m.status === "refunded" ? "neutral" : "success"}>{m.status === "pending" ? "Due" : m.status === "paid_held" ? "Held" : m.status === "released" ? "Released" : "Refunded"}</Pill></span>]), ["Total", formatNaira(v.job.total_kobo)]]
              : [["Job value", formatNaira(v.job.total_kobo)], [`ConnectMe fee (${v.job.commission_bps / 100}%)`, formatNaira(v.job.total_kobo - (v.payout_kobo ?? 0))], ["You receive", formatNaira(v.payout_kobo ?? 0)]]} />
            {!isCust && !paid && <p className="mt-3 text-xs text-muted">The address unlocks once the customer’s payment is held.</p>}
          </Card>
          {isCust && ACTIVE.includes(status) && (
            <Card><SectionTitle>Stay safe</SectionTitle>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink/80"><li>Check the provider’s face and name against this page.</li><li>Ask for nothing, give nothing: they must ask you for the door code.</li><li>Never pay outside ConnectMe.</li></ul>
              {v.trusted_contact?.phone ? <a className="btn btn-ghost mt-3 !text-sm" href={`sms:${v.trusted_contact.phone}?body=${encodeURIComponent(shareText)}`}>Text {v.trusted_contact.name ?? "my trusted contact"}</a>
                : <><Button variant="ghost" className="mt-3" onClick={share}>Share booking</Button><Link to="/account" className="mt-2 block text-center text-xs font-semibold text-brand">Add a trusted contact</Link></>}
            </Card>
          )}
          {canReport && !(isCust && status === "completed_by_provider") && <Button variant="ghost" onClick={() => { setDErr(""); setDlg("problem"); }}>Report a problem</Button>}
          {["awaiting_payment", "paid_held", "on_the_way", "arrived"].includes(status) && <Button variant="ghost" onClick={() => { setDErr(""); setDlg("cancel"); }}>Cancel this job</Button>}
        </aside>
      </div>

      <Dialog open={dlg === "confirm"} onClose={() => setDlg(null)} title="Release the payment?"
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Not yet</Button><Button loading={confirm.isPending} onClick={() => confirm.mutate()}>Yes, release payment</Button></>}>
        <p className="text-sm text-ink/80">{formatNaira(v.job.total_kobo)} goes to {otherName}. You cannot reverse this, so only confirm if the work is complete and you are satisfied.</p>
      </Dialog>
      <Dialog open={dlg === "problem"} onClose={() => setDlg(null)} title="Report a problem"
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button variant="danger" loading={dispute.isPending} onClick={() => { setDErr(""); dispute.mutate(); }}>Report to ConnectMe</Button></>}>
        <p className="mb-3 text-sm text-muted">Payment stays held while our team reviews. Both sides are heard before anything is decided.</p>
        <label htmlFor="rs" className="mb-1 block text-sm font-semibold">What happened?</label>
        <select id="rs" className="input mb-3" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <textarea aria-label="Details" rows={4} className="input" placeholder="Describe what happened, with times if you can." value={detail} onChange={(e) => setDetail(e.target.value)} />
        {dErr && <div className="mt-3"><Alert tone="danger">{dErr}</Alert></div>}
      </Dialog>
      <Dialog open={dlg === "cancel"} onClose={() => setDlg(null)} title="Cancel this job?"
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Keep the job</Button><Button variant="danger" loading={cancelJob.isPending} onClick={() => { setDErr(""); cancelJob.mutate(); }}>Cancel job</Button></>}>
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-ink/80">
          {status === "awaiting_payment" && <li>Nothing has been charged, so nothing is refunded.</li>}
          {status === "paid_held" && <li>{isCust ? "You are refunded in full." : "The customer is refunded in full. Repeated cancellations lower your ranking."}</li>}
          {(status === "on_the_way" || status === "arrived") && <li>{isCust ? "The provider has already set out, so a small callout fee (up to 15% of the payment) may be kept. The rest is refunded." : "The customer is refunded in full. Repeated cancellations lower your ranking."}</li>}
        </ul>
        <textarea aria-label="Reason" rows={3} className="input" placeholder="Why are you cancelling?" value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} />
        {dErr && <div className="mt-3"><Alert tone="danger">{dErr}</Alert></div>}
      </Dialog>
      <Dialog open={dlg === "code"} onClose={() => setDlg(null)} title="Enter the customer’s door code"
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={code.length !== 4} loading={advance.isPending} onClick={() => { setDErr(""); advance.mutate({ to: "working", c: code }); }}>Start work</Button></>}>
        <p className="mb-3 text-sm text-muted">Ask {otherName} for the 4-digit code on their ConnectMe job page. Do not start without it.</p>
        <input aria-label="Door code" className="input text-center text-3xl tracking-[.6em]" inputMode="numeric" maxLength={4} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        {dErr && <div className="mt-3"><Alert tone="danger">{dErr}</Alert></div>}
      </Dialog>
    </>
  );
}
