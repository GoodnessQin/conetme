import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { messageFrom, publicUrl, rpc } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { DocThumb } from "../../components/DocUploader";
import { Alert, Avatar, Button, Card, Dialog, EmptyState, ListSkeleton, Pill, useToast } from "../../components/ui";

interface Change {
  id: string; kind: "area" | "service" | "photo"; provider_id: string; provider_name: string; created_at: string;
  payload: { area_id?: string; service_id?: string; typical_price_kobo?: number; note?: string; doc_paths?: string[]; avatar_path?: string };
  current_area: string | null; new_area: string | null; service_name: string | null; current_avatar: string | null;
}

export default function Changes() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin-changes"], refetchInterval: 30_000, queryFn: () => rpc<Change[]>("admin_provider_changes") });
  const [rej, setRej] = useState<Change | null>(null); const [reason, setReason] = useState(""); const [err, setErr] = useState("");
  const decide = useMutation({
    mutationFn: (a: { id: string; approve: boolean; note: string | null }) => rpc("admin_decide_change", { p_id: a.id, p_approve: a.approve, p_note: a.note }),
    onSuccess: (_d, a) => { toast(a.approve ? "Approved and applied." : "Declined. The provider was told why."); setRej(null); setReason(""); setErr(""); qc.invalidateQueries({ queryKey: ["admin-changes"] }); },
    onError: (e) => setErr(messageFrom(e)),
  });
  if (q.isLoading) return <ListSkeleton />;
  if (!q.data?.length) return <EmptyState title="No profile changes waiting" body="When an approved provider asks to change their area, add a service or replace their photo, it appears here." />;
  return (
    <>
      {err && !rej && <div className="mb-3"><Alert tone="danger">{err}</Alert></div>}
      <div className="space-y-3">
        {q.data.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">{c.provider_name} <Pill tone="brand">{c.kind === "area" ? "Area change" : c.kind === "service" ? "New service" : "Profile photo"}</Pill></p>
                <p className="text-xs text-muted">Sent {fmtDateTime(c.created_at)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="danger" className="!w-auto !px-5 !py-2 !text-sm" onClick={() => { setErr(""); setReason(""); setRej(c); }}>Decline</Button>
                <Button className="!w-auto !px-5 !py-2 !text-sm" loading={decide.isPending && decide.variables?.id === c.id} onClick={() => decide.mutate({ id: c.id, approve: true, note: null })}>Approve</Button>
              </div>
            </div>
            {c.kind === "area" && <p className="mt-3 rounded-2xl bg-surface p-3 text-sm">From <b>{c.current_area}</b> to <b>{c.new_area}</b>. Check that the address proof supports the new area.</p>}
            {c.kind === "service" && (
              <div className="mt-3 rounded-2xl bg-surface p-3 text-sm">
                <p><b>{c.service_name}</b> · typical price {formatNaira(c.payload.typical_price_kobo ?? 0)}</p>
                <p className="mt-1 text-muted">{c.payload.note}</p>
                <div className="mt-2 flex flex-wrap gap-3">{c.payload.doc_paths?.map((d) => <DocThumb key={d} path={d} alt="Credential" />)}</div>
              </div>
            )}
            {c.kind === "photo" && (
              <div className="mt-3 flex items-center gap-6 rounded-2xl bg-surface p-3">
                <div className="text-center"><Avatar name={c.provider_name} path={c.current_avatar} size={72} /><p className="mt-1 text-xs text-muted">Current</p></div>
                <span className="text-2xl text-muted">→</span>
                <div className="text-center"><img src={publicUrl("avatars", c.payload.avatar_path) ?? ""} alt="Requested photo" className="h-[72px] w-[72px] rounded-full object-cover" /><p className="mt-1 text-xs text-muted">Requested</p></div>
                <p className="flex-1 text-xs text-muted">Compare the requested photo with the verification selfie on the provider’s application before approving.</p>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Dialog open={!!rej} onClose={() => setRej(null)} title="Decline this request"
        footer={<><Button variant="ghost" onClick={() => setRej(null)}>Cancel</Button><Button variant="danger" loading={decide.isPending} onClick={() => rej && decide.mutate({ id: rej.id, approve: false, note: reason })}>Decline</Button></>}>
        <p className="mb-2 text-sm text-muted">The provider sees this reason. Say what they can do next.</p>
        <textarea aria-label="Reason" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <div className="mt-3"><Alert tone="danger">{err}</Alert></div>}
      </Dialog>
    </>
  );
}
