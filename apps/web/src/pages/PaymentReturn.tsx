import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { invokeFn, messageFrom } from "../lib/api";
import { Alert, Button, Card } from "../components/ui";

/** The customer lands here after Paystack. We confirm the payment with the server before showing the job. */
export default function PaymentReturn() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const reference = sp.get("ref") ?? sp.get("reference") ?? "";
  const job = sp.get("job");
  const [state, setState] = useState<"checking" | "failed" | "pending">("checking");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 6 && !cancelled; i++) {
        try {
          const r = await invokeFn<{ status: string; job_id?: string }>("paystack-verify", { reference });
          if (r.status === "success") { await qc.invalidateQueries(); nav(`/jobs/${r.job_id ?? job}`, { replace: true }); return; }
          if (r.status === "failed" || r.status === "abandoned") { setState("failed"); return; }
        } catch (e) { setMsg(messageFrom(e)); }
        await new Promise((res) => setTimeout(res, 2500));
      }
      if (!cancelled) setState("pending");
    })();
    return () => { cancelled = true; };
  }, [reference, job, nav, qc]);

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card className="text-center">
        {state === "checking" && <><p className="text-lg font-bold">Confirming your payment…</p><p className="mt-1 text-sm text-muted">Please do not close this page. This takes a few seconds.</p></>}
        {state === "failed" && <><Alert tone="danger" title="The payment did not go through">You have not been charged for this attempt. Go back to the job and try again.</Alert>{job && <Link to={`/jobs/${job}`}><Button className="mt-4">Back to the job</Button></Link>}</>}
        {state === "pending" && <><Alert tone="warning" title="We are still waiting for the bank">{msg || "If you were charged, the job will update on its own within a few minutes. You do not need to pay again."}</Alert>{job && <Link to={`/jobs/${job}`}><Button className="mt-4">Open the job</Button></Link>}</>}
      </Card>
    </div>
  );
}
