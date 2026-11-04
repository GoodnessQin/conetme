import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { otpSchema, phoneSchema } from "@connectme/shared";
import { supabase, isConfigured } from "../lib/supabase";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth/AuthProvider";

const phoneForm = z.object({ phone: phoneSchema });
const codeForm = z.object({ code: otpSchema });
const RESEND_SECONDS = 30;

function friendly(message: string, login: boolean): string {
  const m = message.toLowerCase();
  if (login && (m.includes("signups not allowed") || m.includes("not allowed for otp") || m.includes("user not found"))) return "We could not find an account with this number. Check it, or create an account instead.";
  if (m.includes("rate") || m.includes("seconds")) return "Too many tries. Wait a moment and try again.";
  if (m.includes("expired") || m.includes("invalid")) return "That code is wrong or has expired. Check it or ask for a new one.";
  return "Something went wrong. Check your connection and try again.";
}

export default function SignIn() {
  const nav = useNavigate();
  const login = false; // one flow for new and returning people: the code decides, then the profile decides where they land
  const { session, loading } = useAuth();
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const pf = useForm<{ phone: string }>({ resolver: zodResolver(phoneForm) as never });
  const cf = useForm<z.infer<typeof codeForm>>({ resolver: zodResolver(codeForm) });

  if (!loading && session) return <Navigate to="/app" replace />;

  async function sendCode(p: string) {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ phone: p, options: { shouldCreateUser: !login } });
    if (error) return setError(friendly(error.message, login));
    setPhone(p);
    setCooldown(RESEND_SECONDS);
  }

  async function verify({ code }: { code: string }) {
    if (!phone) return;
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    if (error) return setError(friendly(error.message, login));
    nav("/app", { replace: true });
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-6 py-8">
      <Logo size={30} />
      {!isConfigured && (
        <div className="card mt-6 text-sm">
          Setup needed: copy <code>apps/web/.env.example</code> to <code>.env.local</code> and add your Supabase URL and
          anon key.
        </div>
      )}
      {!phone ? (
        <form className="mt-10" onSubmit={pf.handleSubmit((v) => sendCode(v.phone))} noValidate>
          <h1 className="text-3xl font-extrabold tracking-tight">Enter your phone number</h1>
          <p className="mt-2 text-muted">We will text you a 6-digit code. New or returning, it is the same step. No password needed.</p>
          <label htmlFor="phone" className="mt-6 block text-sm font-medium">Phone number</label>
          <div className="mt-1 flex gap-2">
            <span className="input w-auto select-none text-muted">+234</span>
            <input id="phone" className="input" inputMode="tel" autoComplete="tel-national" placeholder="803 123 4567" {...pf.register("phone")} />
          </div>
          {pf.formState.errors.phone && <p role="alert" className="mt-2 text-sm text-danger">{pf.formState.errors.phone.message}</p>}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <button className="btn mt-6" disabled={pf.formState.isSubmitting}>Send code</button>
        </form>
      ) : (
        <form className="mt-10" onSubmit={cf.handleSubmit(verify)} noValidate>
          <h1 className="text-3xl font-extrabold tracking-tight">Enter the code</h1>
          <p className="mt-2 text-muted">Sent to {phone}. It can take a minute on some networks.</p>
          <label htmlFor="code" className="mt-6 block text-sm font-medium">6-digit code</label>
          <input id="code" className="input mt-1 text-center text-2xl tracking-[.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...cf.register("code")} />
          {cf.formState.errors.code && <p role="alert" className="mt-2 text-sm text-danger">{cf.formState.errors.code.message}</p>}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <button className="btn mt-6" disabled={cf.formState.isSubmitting}>Confirm and continue</button>
          <button type="button" className="btn btn-ghost mt-3" disabled={cooldown > 0} onClick={() => phone && sendCode(phone)}>
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
          </button>
          <button type="button" className="mt-4 w-full text-sm text-muted underline" onClick={() => { setPhone(null); setError(null); }}>
            Use a different number
          </button>
        </form>
      )}
    </main>
  );
}
