import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { fullNameSchema } from "@connectme/shared";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { Logo } from "../components/Logo";
import { LegalLinks, TERMS_VERSION } from "./Legal";

const schema = z.object({ full_name: fullNameSchema });

export default function Welcome() {
  const nav = useNavigate();
  const { session, profile, refresh } = useAuth();
  const [intent, setIntent] = useState<"customer" | "provider">("customer");
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { full_name: profile?.full_name ?? "" } });

  async function save(v: z.infer<typeof schema>) {
    if (!session) return;
    setError(null);
    const { error } = await supabase.from("profiles").update({ full_name: v.full_name, terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION }).eq("id", session.user.id);
    if (error) return setError("We could not save your name. Check your connection and try again.");
    await refresh();
    nav(intent === "provider" ? "/provider" : "/customer", { replace: true });
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-6 py-8">
      <Logo size={30} />
      <h1 className="mt-10 text-3xl font-extrabold tracking-tight">Tell us who you are</h1>
      <p className="mt-2 text-muted">Use the name on your government ID. Providers see only your first name, and only after you pay for a job.</p>
      <form className="mt-6" onSubmit={handleSubmit(save)} noValidate>
        <label htmlFor="name" className="block text-sm font-semibold">Full name</label>
        <input id="name" className="input mt-1" autoComplete="name" placeholder="Ngozi Adeyemi" {...register("full_name")} />
        {formState.errors.full_name && <p role="alert" className="mt-2 text-sm text-danger">{formState.errors.full_name.message}</p>}
        <fieldset className="mt-6">
          <legend className="text-sm font-semibold">How will you use ConnectMe?</legend>
          {([["customer", "I need a service done", "Post a job and compare offers from verified providers."], ["provider", "I offer a service", "Register, get verified by our team, and receive job requests."]] as const).map(([v, t, s]) => (
            <label key={v} className={`mt-2 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${intent === v ? "border-brand bg-brand-50" : "border-line"}`}>
              <input type="radio" name="intent" className="mt-1 accent-brand" checked={intent === v} onChange={() => setIntent(v)} />
              <span><b>{t}</b><br /><span className="text-sm text-muted">{s}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="mt-3 text-xs text-muted">You can do both later with the same account.</p>
        <LegalLinks className="mt-4" />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button className="btn mt-6" disabled={formState.isSubmitting}>Continue</button>
      </form>
    </main>
  );
}
