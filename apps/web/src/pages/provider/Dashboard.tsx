import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHECK_LABELS, CHECK_TYPES, formatNaira, type CheckType } from "@connectme/shared";
import { supabase } from "../../lib/supabase";
import { rpc } from "../../lib/api";
import { useMyProvider } from "../../lib/queries";
import type { InboxRow, Progress } from "../../lib/types";
import { Alert, Avatar, Card, ListSkeleton, PageHeader, Pill, ProgressBar, SectionTitle, Stars, Switch, useToast, VerifiedBadge } from "../../components/ui";
import { useAuth } from "../../auth/AuthProvider";
import { fmtDate, timeLeft } from "../../lib/format";

const REQUIREMENTS = [
  ["Identity", "NIN and a live selfie matched to your ID"], ["Guarantor", "Someone who knows you and will vouch for you"],
  ["Bank account", "In your own name, matching your ID"], ["Proof of address", "A recent bill, tenancy or community letter"],
  ["Credentials", "Certificates or proof of past work for your service"], ["References", "Two people we can call about your work"],
];

export default function ProviderDashboard() {
  const { profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const prog = useQuery({ queryKey: ["progress"], queryFn: () => rpc<Progress>("my_verification_progress") });
  const prov = useMyProvider();
  const approved = prog.data?.status === "approved";
  const inbox = useQuery({ queryKey: ["provider-inbox"], enabled: approved, refetchInterval: 10_000, queryFn: () => rpc<InboxRow[]>("provider_inbox") });
  const toggle = useMutation({
    mutationFn: async (v: boolean) => { const { error } = await supabase.from("providers").update({ available_today: v }).eq("id", prov.data!.id); if (error) throw error; },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["my-provider"] }); toast(v ? "You are available today. New requests will reach you." : "You are unavailable today. Same-day requests will skip you."); },
  });
  if (prog.isLoading || prov.isLoading) return <ListSkeleton />;
  const p = prog.data!;
  const status = p.status;

  if (!p.has_provider) {
    return (
      <>
        <PageHeader title="Earn from verified jobs" subtitle="Customers in your area post jobs. You send your price, and the customer chooses." />
        <Card>
          <SectionTitle>What we ask of every provider</SectionTitle>
          <p className="mb-4 text-sm text-muted">You will be let into people’s homes, so we verify who you are before you can bid. Registration takes about 20 minutes. Your progress saves as you go.</p>
          <ul className="grid gap-3 sm:grid-cols-2">{REQUIREMENTS.map(([t, d]) => <li key={t} className="rounded-2xl bg-surface p-4"><p className="font-bold">{t}</p><p className="text-sm text-muted">{d}</p></li>)}</ul>
          <Link to="/provider/register" className="btn mt-5">Start your application</Link>
        </Card>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[["You set your price", "Send an offer on every request you want. No bidding fees."], ["Your payment is protected", "The customer pays up front. ConnectMe holds it until the job is confirmed."], ["Ratings build your income", "Better ratings rank you higher and unlock larger jobs."]].map(([t, d]) => <Card key={t}><p className="font-bold">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></Card>)}
        </div>
      </>
    );
  }

  if (status === "draft" || status === "needs_info") {
    const done = [p.profile, (p.services ?? 0) > 0, p.nin && p.id_photo && p.selfie, p.bank, p.guarantor, p.address_doc, (p.credentials ?? 0) > 0, (p.portfolio ?? 0) >= 3 && (p.references ?? 0) >= 2].filter(Boolean).length;
    return (
      <>
        <PageHeader title={status === "needs_info" ? "More information needed" : "Finish your application"} subtitle={`${done} of 8 sections complete`} />
        {status === "needs_info" && <div className="mb-4"><Alert tone="warning" title="Message from our review team">{p.decision_note}</Alert></div>}
        <Card><ProgressBar value={(done / 8) * 100} label="Application progress" />
          <p className="mt-3 text-sm text-muted">Applications are reviewed within 1 to 2 working days once submitted.</p>
          <Link to="/provider/register" className="btn mt-4">{status === "needs_info" ? "Update your application" : "Continue application"}</Link></Card>
      </>
    );
  }

  if (status === "submitted" || status === "in_review") {
    const checks = new Map((p.checks ?? []).map((c) => [c.type, c.status]));
    return (
      <>
        <PageHeader title="Application under review" subtitle={`Submitted ${fmtDate(p.submitted_at)}. Reviews normally take 1 to 2 working days.`} actions={<Pill tone="warning">{status === "in_review" ? "In review" : "Received"}</Pill>} />
        <Card>
          <SectionTitle>Your eight checks</SectionTitle>
          <ul className="divide-y divide-line">
            {CHECK_TYPES.map((t) => {
              const s = checks.get(t) ?? "not_checked";
              const tone = s === "pass" ? "success" : s === "fail" ? "danger" : "neutral";
              return <li key={t} className="flex items-center justify-between gap-3 py-3 text-sm"><span><b>{CHECK_LABELS[t].title}</b></span><Pill tone={tone}>{s === "pass" ? "Passed" : s === "fail" ? "Needs attention" : "Waiting for review"}</Pill></li>;
            })}
          </ul>
          <p className="mt-4 text-sm text-muted">Keep your phone on. We will call your guarantor and references, and may contact you if anything is unclear.</p>
        </Card>
      </>
    );
  }

  if (status === "rejected" || status === "suspended") {
    return (
      <>
        <PageHeader title={status === "rejected" ? "Application not approved" : "Account suspended"} />
        <Alert tone="danger" title="Decision">{p.decision_note ?? "Contact ConnectMe support for details."}</Alert>
      </>
    );
  }

  const d = prov.data!;
  const open = (inbox.data ?? []).filter((r) => r.request_status !== "expired" && ["open", "offers_received"].includes(r.request_status) && !r.my_offer_id);
  return (
    <>
      <PageHeader title={`Welcome back, ${d.display_name.split(" ")[0]}`} subtitle="Respond quickly. The first strong offers usually win." actions={<VerifiedBadge level={d.level} />} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3"><Avatar name={d.display_name} path={profile?.avatar_path} size={56} /><div><p className="font-bold">{d.display_name}</p><Stars value={d.rating_avg} count={d.rating_count} /></div></div>
            <div className="flex items-center gap-3"><div className="text-right"><p className="text-sm font-bold">Available today</p><p className="text-xs text-muted">{d.available_today ? "Receiving same-day requests" : "Skipping same-day requests"}</p></div>
              <Switch label="Available today" checked={d.available_today} onChange={(v) => toggle.mutate(v)} disabled={toggle.isPending} /></div>
          </div>
        </Card>
        <Card><p className="text-sm text-muted">Jobs completed</p><p className="text-3xl font-extrabold">{d.jobs_completed}</p>
          <p className="mt-1 text-xs text-muted">Earnings appear here after your first completed job.</p></Card>
      </div>
      <Card className="mt-4 bg-surface">
        <p className="text-sm"><b>Your job limit: {formatNaira(10_000_000)}.</b> New providers can send offers up to this value. It rises as you complete jobs with good ratings.</p>
      </Card>

      <div className="mt-8">
        <SectionTitle aside={<Link to="/provider/requests" className="text-sm font-semibold text-brand">View all</Link>}>New requests for you</SectionTitle>
        {inbox.isLoading && <ListSkeleton rows={2} />}
        {!inbox.isLoading && open.length === 0 && <Card><p className="text-sm text-muted">No open requests right now. {d.available_today ? "You will be alerted when a customer near you posts a job." : "Switch on “Available today” to receive same-day requests."}</p></Card>}
        <div className="space-y-3">
          {open.slice(0, 3).map((r) => (
            <Link key={r.request_id} to={`/provider/requests/${r.request_id}`} className="block rounded-card border border-line bg-white p-4 shadow-sm hover:border-brand">
              <div className="flex items-center justify-between gap-3"><div><p className="font-bold">{r.service_name}{r.urgent && <span className="ml-2 text-xs font-bold text-danger">URGENT</span>}</p>
                <p className="text-sm text-muted">{r.area_name}{r.distance_km != null ? ` · ${r.distance_km} km from you` : ""}</p></div><Pill tone="neutral">{timeLeft(r.expires_at)}</Pill></div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
