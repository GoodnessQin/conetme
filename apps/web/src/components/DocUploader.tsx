import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { messageFrom, signedUrl, uploadFile } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button } from "./ui";

interface DocRow { id: string; type: string; storage_path: string; uploaded_at: string }

export function DocThumb({ path, bucket = "verification", alt }: { path: string; bucket?: "verification" | "request-photos"; alt: string }) {
  const isImg = /\.(jpe?g|png|webp|gif|heic)$/i.test(path);
  const q = useQuery({ queryKey: ["signed", bucket, path], staleTime: 8 * 60_000, queryFn: () => signedUrl(bucket, path) });
  if (!isImg) return <a href={q.data ?? "#"} target="_blank" rel="noreferrer" className="grid h-20 w-20 place-items-center rounded-xl bg-surface text-xs font-bold text-brand">Open file</a>;
  return q.data ? <a href={q.data} target="_blank" rel="noreferrer"><img src={q.data} alt={alt} className="h-20 w-20 rounded-xl border border-line object-cover" /></a> : <div className="h-20 w-20 animate-pulse rounded-xl bg-surface" />;
}

/** Uploads a private verification document and records it against the provider's case. */
export function DocUploader({ caseId, type, label, hint, accept = "image/*,application/pdf", capture, max = 5, locked }: {
  caseId: string; type: "id_photo" | "selfie" | "address_proof" | "credential"; label: string; hint?: string; accept?: string;
  capture?: "user" | "environment"; max?: number; locked?: boolean;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const key = ["docs", caseId, type];
  const docs = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("verification_documents").select("id,type,storage_path,uploaded_at").eq("case_id", caseId).eq("type", type).order("uploaded_at");
      if (error) throw error;
      return data as DocRow[];
    },
  });
  const [progress, setProgress] = useState("");
  const add = useMutation({
    mutationFn: async (files: File[]) => {
      const room = max - (docs.data?.length ?? 0);
      const batch = files.slice(0, room);
      const skipped = files.length - batch.length;
      for (let i = 0; i < batch.length; i++) {
        const file = batch[i]!;
        setProgress(batch.length > 1 ? `Uploading ${i + 1} of ${batch.length}…` : "");
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is over 10 MB. Choose a smaller file or take a new photo.`);
        const path = await uploadFile("verification", session!.user.id, type, file);
        const { error } = await supabase.from("verification_documents").insert({ case_id: caseId, type, storage_path: path, original_name: file.name.slice(0, 120) });
        if (error) throw error;
        await qc.invalidateQueries({ queryKey: key });
      }
      if (skipped > 0) throw new Error(`Only ${max} files are allowed here, so ${skipped} ${skipped === 1 ? "file was" : "files were"} skipped.`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["progress"] }); setErr(""); setProgress(""); },
    onError: (e) => { setErr(messageFrom(e)); setProgress(""); qc.invalidateQueries({ queryKey: ["progress"] }); },
  });
  const remove = useMutation({
    mutationFn: async (d: DocRow) => {
      const { error } = await supabase.from("verification_documents").delete().eq("id", d.id);
      if (error) throw error;
      await supabase.storage.from("verification").remove([d.storage_path]);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["progress"] }); },
    onError: (e) => setErr(messageFrom(e)),
  });
  const list = docs.data ?? [];
  return (
    <div className="mb-5 rounded-2xl border border-line p-4">
      <p className="font-semibold">{label}</p>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {list.map((d) => (
          <div key={d.id} className="relative">
            <DocThumb path={d.storage_path} alt={label} />
            {!locked && <button type="button" aria-label="Remove file" onClick={() => remove.mutate(d)} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-ink text-xs text-white">✕</button>}
          </div>
        ))}
        {!locked && list.length < max && (
          <>
            <input ref={input} type="file" accept={accept} capture={capture} multiple={max > 1 && !capture} className="sr-only" aria-label={label}
              onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) add.mutate(f); e.target.value = ""; }} />
            <Button type="button" variant="ghost" className="!w-auto !px-5 !py-2.5 !text-sm" loading={add.isPending} onClick={() => input.current?.click()}>
              {list.length ? (max > 1 ? "Add more" : "Replace") : capture ? "Take photo" : max > 1 ? "Choose files" : "Choose file"}
            </Button>
          </>
        )}
      </div>
      {progress && <p className="mt-2 text-xs font-semibold text-brand">{progress}</p>}
      {list.length > 0 && <p className="mt-2 text-xs font-semibold text-success">✓ {list.length} {list.length === 1 ? "file" : "files"} uploaded{max > 1 ? ` (up to ${max})` : ""}</p>}
      {err && <div className="mt-2"><Alert tone="danger">{err}</Alert></div>}
    </div>
  );
}
