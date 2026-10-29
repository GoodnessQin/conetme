import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHECK_LABELS, ID_TYPES, formatNaira, type CheckType } from "@connectme/shared";
import { messageFrom, publicUrl, rpc } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { DocThumb } from "../../components/DocUploader";
import { Alert, Avatar, Button, Card, Dialog, KeyValue, ListSkeleton, PageHeader, Pill, SectionTitle, useToast } from "../../components/ui";

interface Chk { id: string; type: CheckType; status: "not_checked" | "pending" | "pass" | "fail" | "review"; note: string | null; checked_at: string | null }
interface CaseData {
  case: { id: string; status: string; submitted_at: string; rejection_reason: string | null; checklist: { consented_at?: string } };
  provider: { id: string; name: string; bio: string | null; years: number | null; radius_km: number; status: string; area: string | null };
  account: { full_name: string; phone: string; avatar: string | null };
  private: { nin_last4: string | null; id_type: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_name: string | null } | null;
  guarantor: { name: string; phone: string; relationship: string; address: string | null; years_known: number | null; confirmed_at: string | null } | null;
  references: { name: string; phone: string; relationship: string; called_at: string | null }[];
  services: { name: string; slug: string; typical_price_kobo: number | null }[];
  portfolio: { path: string; caption: string | null }[];
  documents: { id: string; type: string; path: string; name: string | null; uploaded_at: string }[];
  checks: Chk[];
}
const DOC_LABEL: Record<string, string> = { id_photo: "ID photo", selfie: "Selfie", address_proof: "Proof of address", credential: "Credential" };

function CheckRow({ c, locked, onSaved }: { c: Chk; locked: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<Chk["status"]>(c.status);
  const [note, setNote] = useState(c.note ?? "");
  const [err, setErr] = useState("");
  const save = useMutation({
    mutationFn: () => rpc("admin_set_check", { p_check: c.id, p_status: status, p_note: note }),
    onSuccess: () => { toast(`${CHECK_LABELS[c.type].title} saved.`); setErr(""); onSaved(); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const dirty = status !== c.status || note !== (c.note ?? "");
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-start justify-between gap-3"><p className="font-bold">{CHECK_LABELS[c.type].title}</p>
        <Pill tone={c.status === "pass" ? "success" : c.status === "fail" ? "danger" : "neutral"}>{c.status === "pass" ? "Passed" : c.status === "fail" ? "Failed" : "Open"}</Pill></div>
      <p className="mt-1 text-sm text-muted">{CHECK_LABELS[c.type].reviewerGuide}</p>
      {!locked && (
        <>
          <div className="mt-3 flex gap-2" role="group" aria-label={`${CHECK_LABELS[c.type].title} result`}>
            {([["pass", "Pass"], ["fail", "Fail"], ["review", "Needs a second look"]] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}
                className={`rounded-full px-4 py-1.5 text-sm font-bold ${status === v ? (v === "pass" ? "bg-success text-white" : v === "fail" ? "bg-danger text-white" : "bg-ink text-white") : "bg-surface text-muted"}`}>{l}</button>
            ))}
          </div>
          <textarea aria-label="Reviewer note" rows={2} className="input mt-3" placeholder="Note for the record (required if you fail the check)" value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
          <Button className="mt-3 !w-auto !px-6 !py-2.5 !text-sm" disabled={!dirty || status === "not_checked"} loading={save.isPending} onClick={() => save.mutate()}>Save result</Button>
        </>
      )}
      {locked && c.note && <p className="mt-2 rounded-xl bg-surface p-2 text-sm">{c.note}</p>}
      {c.checked_at && <p className="mt-2 text-xs text-muted">Last updated {fmtDateTime(c.checked_at)}</p>}
    </div>
  );
}

export default function CaseDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin-case", id], queryFn: () => rpc<CaseData>("admin_case", { p_case: id }) });
  const [dlg, setDlg] = useState<null | "reject" | "needs_info">(null);
  const [reason, setReason] = useState(""); const [err, setErr] = useState("");
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ["admin-queue"] }); };
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject" | "needs_info") => rpc("admin_decide", { p_case: id, p_decision: d, p_reason: reason }),
    onSuccess: (_, d) => { toast(d === "approve" ? "Provider approved. They can now receive requests." : d === "reject" ? "Application rejected." : "Sent back to the provider."); qc.invalidateQueries({ queryKey: ["admin-queue"] }); nav("/admin"); },
    onError: (e) => setErr(messageFrom(e)),
  });
  if (q.isLoading) return <ListSkeleton />;
  if (!q.data) return <Alert tone="danger" title="Case not available">{messageFrom(q.error)}</Alert>;
  const d = q.data;
  const open = ["submitted", "in_review"].includes(d.case.status);
  const passed = d.checks.filter((c) => c.status === "pass").length;
  const allPass = d.checks.length === 8 && passed === 8;
  const idLabel = ID_TYPES.find((t) => t.value === d.private?.id_type)?.label ?? "ID";
  const docs = d.documents;

  return (
    <>
      <PageHeader back={{ to: "/admin", label: "Queue" }} title={d.provider.name} subtitle={`${d.services.map((s) => s.name).join(", ")} · ${d.provider.area}`}
        actions={<Pill tone={open ? "brand" : d.case.status === "approved" ? "success" : "neutral"}>{d.case.status.replace("_", " ")}</Pill>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card>
            <div className="flex items-center gap-4"><Avatar name={d.provider.name} path={d.account.avatar} size={64} /><div className="min-w-0"><p className="font-bold">{d.account.full_name}</p>
              <a href={`tel:${d.account.phone}`} className="text-sm font-semibold text-brand">{d.account.phone}</a><p className="text-xs text-muted">Applicant account phone, confirmed by one-time code</p></div></div>
            {d.provider.bio && <p className="mt-3 text-sm">{d.provider.bio}</p>}
            <KeyValue items={[["Experience", `${d.provider.years ?? 0} years`], ["Travel range", `${d.provider.radius_km} km`], ["Submitted", fmtDateTime(d.case.submitted_at)], ["Consent recorded", d.case.checklist.consented_at ? fmtDateTime(d.case.checklist.consented_at) : "No"]]} />
          </Card>

          <Card>
            <SectionTitle>Identity and bank</SectionTitle>
            <KeyValue items={[["ID type", idLabel], ["NIN (last four)", d.private?.nin_last4 ?? "Missing"], ["Bank", d.private?.bank_name ?? ""], ["Account number", d.private?.bank_account_number ?? ""], ["Account name", d.private?.bank_account_name ?? ""], ["Applicant name", d.account.full_name]]} />
            <p className="mt-2 text-xs text-muted">The account name must match the name on the ID photo below.</p>
          </Card>

          <Card>
            <SectionTitle>Documents ({docs.length})</SectionTitle>
            {(["id_photo", "selfie", "address_proof", "credential"] as const).map((t) => {
              const list = docs.filter((x) => x.type === t);
              return (
                <div key={t} className="mb-4">
                  <p className="mb-1.5 text-sm font-bold">{DOC_LABEL[t]} {list.length === 0 && <span className="font-normal text-danger">· missing</span>}</p>
                  <div className="flex flex-wrap gap-3">{list.map((x) => <div key={x.id} className="w-24"><DocThumb path={x.path} alt={DOC_LABEL[t] ?? t} /><p className="mt-1 truncate text-[11px] text-muted" title={x.name ?? ""}>{x.name ?? "file"}</p></div>)}</div>
                </div>
              );
            })}
            <p className="text-xs text-muted">Files open in a new tab through a private link that expires in 10 minutes. Each file shows the name it was uploaded with. Documents are filed under the applicant on this page.</p>
          </Card>

          <Card>
            <SectionTitle>Services</SectionTitle>
            <KeyValue items={d.services.map((s): [string, string] => [s.name, s.typical_price_kobo ? `from ${formatNaira(s.typical_price_kobo)}` : "no price"])} />
            <p className="mb-2 mt-4 text-sm font-bold">Past work ({d.portfolio.length})</p>
            <div className="grid grid-cols-3 gap-2">{d.portfolio.map((w) => <figure key={w.path}><img src={publicUrl("portfolio", w.path) ?? ""} alt={w.caption ?? "Past work"} className="aspect-square w-full rounded-xl object-cover" /><figcaption className="truncate text-[11px] text-muted">{w.caption}</figcaption></figure>)}</div>
          </Card>

          <Card>
            <SectionTitle>People to call</SectionTitle>
            {d.guarantor && <div className="mb-3 rounded-2xl bg-surface p-3 text-sm"><p className="font-bold">Guarantor: {d.guarantor.name}</p><a href={`tel:${d.guarantor.phone}`} className="font-semibold text-brand">{d.guarantor.phone}</a>
              <p className="text-muted">{d.guarantor.relationship}, knows applicant {d.guarantor.years_known} years</p><p className="text-muted">{d.guarantor.address}</p></div>}
            {d.references.map((r) => <div key={r.phone} className="mb-2 rounded-2xl bg-surface p-3 text-sm"><p className="font-bold">Reference: {r.name}</p><a href={`tel:${r.phone}`} className="font-semibold text-brand">{r.phone}</a><p className="text-muted">{r.relationship}{r.called_at ? ` · called ${fmtDateTime(r.called_at)}` : ""}</p></div>)}
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card><SectionTitle aside={<Pill tone={allPass ? "success" : "neutral"}>{passed} of 8 passed</Pill>}>Checks</SectionTitle>
            <div className="space-y-3">{d.checks.map((c) => <CheckRow key={c.id + c.status + (c.note ?? "")} c={c} locked={!open} onSaved={refresh} />)}</div></Card>
          {open && (
            <Card>
              <SectionTitle>Decision</SectionTitle>
              {err && <div className="mb-3"><Alert tone="danger">{err}</Alert></div>}
              <Button disabled={!allPass} loading={decide.isPending && !dlg} onClick={() => { setErr(""); decide.mutate("approve"); }}>Approve as Verified Pro</Button>
              {!allPass && <p className="mt-2 text-xs text-muted">Approval unlocks when all eight checks pass.</p>}
              <Button variant="ghost" className="mt-3" onClick={() => { setReason(""); setErr(""); setDlg("needs_info"); }}>Ask for more information</Button>
              <Button variant="danger" className="mt-3" onClick={() => { setReason(""); setErr(""); setDlg("reject"); }}>Reject application</Button>
            </Card>
          )}
          {!open && d.case.rejection_reason && <Alert title="Reason given to the provider">{d.case.rejection_reason}</Alert>}
        </div>
      </div>

      <Dialog open={!!dlg} onClose={() => setDlg(null)} title={dlg === "reject" ? "Reject this application" : "Ask for more information"}
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button variant={dlg === "reject" ? "danger" : "primary"} loading={decide.isPending} onClick={() => dlg && decide.mutate(dlg)}>{dlg === "reject" ? "Reject" : "Send to provider"}</Button></>}>
        <p className="mb-2 text-sm text-muted">{dlg === "reject" ? "The provider sees this reason. Be specific and professional." : "Tell the provider exactly what to fix. They can edit and resubmit."}</p>
        <textarea aria-label="Reason" rows={4} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      </Dialog>
    </>
  );
}
