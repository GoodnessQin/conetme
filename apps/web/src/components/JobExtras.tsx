import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { supabase } from "../lib/supabase";
import { messageFrom, rpc } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { QuoteInfo } from "../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button, Card, Field, Pill, SectionTitle, useToast } from "./ui";

interface Msg { id: string; sender_id: string; body: string; created_at: string }

/** Private chat between the customer and provider of a paid job. Contact details are blocked by the server. */
export function ChatCard({ jobId, otherName }: { jobId: string; otherName: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["chat", jobId], refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("id, sender_id, body, created_at").eq("job_id", jobId).order("created_at").limit(200);
      if (error) throw error;
      return data as Msg[];
    },
  });
  const count = q.data?.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
    if (count > 0) rpc("mark_messages_read", { p_job: jobId }).then(() => qc.invalidateQueries({ queryKey: ["unread"] })).catch(() => undefined);
  }, [count, jobId, qc]);
  const send = useMutation({
    mutationFn: () => rpc("send_message", { p_job: jobId, p_body: text }),
    onSuccess: () => { setText(""); setErr(""); q.refetch(); },
    onError: (e) => setErr(messageFrom(e)),
  });
  return (
    <Card>
      <SectionTitle>Chat with {otherName}</SectionTitle>
      <div className="max-h-72 min-h-[96px] space-y-2 overflow-y-auto rounded-2xl bg-surface p-3" aria-live="polite">
        {count === 0 && <p className="py-4 text-center text-sm text-muted">No messages yet. Use this to share access details or agree a time.</p>}
        {q.data?.map((m) => {
          const mine = m.sender_id === session?.user.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-brand text-white" : "bg-white ring-1 ring-line"}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? "text-white/70" : "text-muted"}`}>{fmtDateTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
        <input aria-label="Message" className="input" maxLength={500} placeholder="Write a message" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" className="!w-auto !px-6" loading={send.isPending} disabled={!text.trim()}>Send</Button>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      <p className="mt-2 text-xs text-muted">Phone numbers, emails and chat app names are blocked. ConnectMe keeps contact details private so you are both protected.</p>
    </Card>
  );
}

/** Solar: after the paid inspection the provider sends a full quote; the customer accepts or declines it. */
export function QuoteCard({ jobId, isCustomer, onChanged }: { jobId: string; isCustomer: boolean; onChanged: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ["quote", jobId], refetchInterval: 8000, queryFn: () => rpc<QuoteInfo | null>("job_quote", { p_job: jobId }) });
  const [price, setPrice] = useState(""); const [scope, setScope] = useState(""); const [err, setErr] = useState("");
  const send = useMutation({
    mutationFn: () => rpc("send_quote", { p_job: jobId, p_price_kobo: Math.round(Number(price) * 100), p_scope: scope }),
    onSuccess: () => { toast("Quote sent. The customer has 7 days to respond."); q.refetch(); onChanged(); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const respond = useMutation({
    mutationFn: (accept: boolean) => rpc<string | null>("respond_quote", { p_quote: q.data!.quote!.id, p_accept: accept }),
    onSuccess: (newJob, accept) => { if (accept && newJob) { toast("Quote accepted. Pay the first stage to start."); nav(`/jobs/${newJob}`); } else { toast("Quote declined."); q.refetch(); } },
    onError: (e) => setErr(messageFrom(e)),
  });
  const d = q.data;
  if (!d || !d.is_quote_service) return null;
  const quote = d.quote;

  if (d.is_follow_up) return <Alert tone="success" title="Full installation">This job is the accepted quote after the site inspection. It is paid in three stages.</Alert>;
  if (!quote && !d.can_send) return isCustomer ? <Alert title="Quote to follow">After the site inspection is confirmed, your provider sends a full quote for you to accept or decline.</Alert> : null;

  if (d.can_send) {
    return (
      <Card className="border-2 border-brand">
        <SectionTitle>Send the full quote</SectionTitle>
        <p className="mb-3 text-sm text-muted">The inspection is complete. Describe the full installation and its price. The customer pays it in three stages: 40% to start, 40% when the equipment is installed, 20% after commissioning.</p>
        <Field label="Total price (₦)" htmlFor="qp"><input id="qp" className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder="1200000" /></Field>
        <Field label="What is included" htmlFor="qs" hint="Equipment and brands, capacity, installation work, warranty terms and timeline. No phone numbers."><textarea id="qs" rows={5} className="input" value={scope} onChange={(e) => setScope(e.target.value)} /></Field>
        {err && <div className="mb-3"><Alert tone="danger">{err}</Alert></div>}
        <Button loading={send.isPending} disabled={Number(price) < 50000 || scope.trim().length < 30} onClick={() => { setErr(""); send.mutate(); }}>Send quote</Button>
      </Card>
    );
  }
  if (!quote) return null;
  return (
    <Card className={quote.status === "sent" && isCustomer ? "border-2 border-brand" : ""}>
      <SectionTitle aside={<Pill tone={quote.status === "accepted" ? "success" : quote.status === "sent" ? "brand" : "neutral"}>{quote.status === "sent" ? "Awaiting answer" : quote.status}</Pill>}>Full installation quote</SectionTitle>
      <p className="text-3xl font-extrabold">{formatNaira(quote.price_kobo)}</p>
      <p className="mt-1 text-xs text-muted">Paid in three stages: 40%, 40% and 20%. Valid until {fmtDateTime(quote.valid_until)}.</p>
      <p className="mt-3 whitespace-pre-line rounded-2xl bg-surface p-3 text-sm">{quote.scope}</p>
      {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
      {isCustomer && quote.status === "sent" && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button variant="ghost" loading={respond.isPending} onClick={() => respond.mutate(false)}>Decline</Button>
          <Button loading={respond.isPending} onClick={() => { setErr(""); respond.mutate(true); }}>Accept quote</Button>
        </div>
      )}
      {quote.status === "accepted" && quote.follow_up_job_id && <Button variant="ghost" className="mt-3" onClick={() => nav(`/jobs/${quote.follow_up_job_id}`)}>Open the installation job</Button>}
    </Card>
  );
}
