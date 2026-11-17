import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Dialog, Button } from "./ui";
import { rememberIntent, rememberNext, signInWithGoogle } from "../lib/entry";
import { useAuth } from "../auth/AuthProvider";

export interface PromptOpts { title?: string; body: string; next?: string; intent?: "customer" | "provider" }
const Ctx = createContext<(o: PromptOpts) => void>(() => undefined);

/** Visitors browse freely. This dialog appears only at the moment an account is genuinely needed. */
export function useSignInPrompt() { return useContext(Ctx); }

export function GoogleButton({ onError }: { onError?: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); const m = await signInWithGoogle(); if (m) { onError?.(m); setBusy(false); } }}
      className="inline-flex w-full items-center justify-center gap-3 rounded-full border-2 border-line bg-white px-6 py-3.5 text-base font-bold text-ink transition hover:border-brand disabled:opacity-50">
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
      Continue with Google
    </button>
  );
}

export function AuthPromptProvider({ children }: { children: ReactNode }) {
  const [o, setO] = useState<PromptOpts | null>(null);
  const [err, setErr] = useState("");
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const { session } = useAuth();
  const open = useCallback((x: PromptOpts) => { if (!session) { setErr(""); setO(x); } }, [session]);
  function remember() { if (!o) return; rememberNext(o.next ?? pathname + search); if (o.intent) rememberIntent(o.intent); }
  return (
    <Ctx.Provider value={open}>
      {children}
      <Dialog open={!!o} onClose={() => setO(null)} title={o?.title ?? "Create your free account"}
        footer={<Button variant="ghost" onClick={() => setO(null)}>Not now</Button>}>
        <p className="text-sm text-muted">{o?.body}</p>
        <div className="mt-4 space-y-3">
          <Button onClick={() => { remember(); setO(null); nav("/sign-in"); }}>Continue with phone number</Button>
          <div onClickCapture={remember}><GoogleButton onError={setErr} /></div>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        </div>
        <p className="mt-3 text-xs text-muted">No password. Free to join. New or returning, it is the same step.</p>
      </Dialog>
    </Ctx.Provider>
  );
}
