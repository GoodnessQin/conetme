import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useSignInPrompt } from "../components/AuthPrompt";
import { useServices } from "../lib/queries";

export default function BecomeProvider() {
  const { session, roles } = useAuth();
  const nav = useNavigate();
  const prompt = useSignInPrompt();
  const services = useServices().data ?? [];
  function start() {
    if (session) return nav(roles.includes("provider") ? "/provider" : "/provider/register");
    prompt({ title: "Start your provider application", body: "Create your free account first. Then we will take you through registration, one short step at a time.", next: "/provider/register", intent: "provider" });
  }
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <section className="rounded-3xl bg-ink p-8 text-white md:p-12">
        <h1 className="max-w-2xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">Get found. Get booked. <span className="text-lime">Get paid.</span></h1>
        <p className="mt-4 max-w-xl text-white/80">ConnectMe sends you customers who are ready to book, and holds their payment so you are never chasing money. Joining is free.</p>
        <button onClick={start} className="mt-6 rounded-full bg-lime px-7 py-3.5 font-extrabold text-ink">{session ? "Continue to registration" : "Start your application"}</button>
      </section>
      <section className="mt-10 grid gap-4 md:grid-cols-3">
        {[["Your own page", "A shareable page with your photo, banner, reviews and prices. Put the link on WhatsApp, Instagram or your business card."], ["Real customers", "Requests arrive from people in your area who have already described the job and the budget."], ["Paid every time", "The customer pays up front and the money is held. After they confirm the work, it goes to your bank account."]].map(([t, d]) => (
          <div key={t} className="rounded-3xl border border-line p-6"><p className="text-lg font-extrabold">{t}</p><p className="mt-2 text-sm text-muted">{d}</p></div>
        ))}
      </section>
      <section className="mt-10 rounded-3xl bg-surface p-6 md:p-10">
        <h2 className="text-2xl font-extrabold tracking-tight">How it works</h2>
        <ol className="mt-5 grid gap-5 md:grid-cols-4">
          {[["Apply", "Sign in, add the services you offer and your area."], ["Get verified", "Upload your ID, address proof, work photos and a guarantor. Our team reviews every application."], ["Go live", "Once approved your page is public and requests start arriving."], ["Earn", "Finish the job, the customer confirms, and you are paid."]].map(([t, d], n) => (
            <li key={t}><span className="grid h-9 w-9 place-items-center rounded-full bg-brand font-extrabold text-white">{n + 1}</span><p className="mt-3 font-bold">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></li>
          ))}
        </ol>
      </section>
      <section className="mt-10"><h2 className="text-2xl font-extrabold tracking-tight">Services open for providers</h2>
        <div className="mt-4 flex flex-wrap gap-2">{services.map((s) => <span key={s.id} className="rounded-full border border-line px-4 py-2 text-sm font-bold">{s.name}</span>)}</div>
        <p className="mt-3 text-sm text-muted">Do something else? <Link to="/faq" className="font-bold text-brand">Ask us</Link>. We open new services based on what customers request.</p></section>
      <section className="mt-10"><h2 className="text-2xl font-extrabold tracking-tight">What you will need</h2>
        <ul className="mt-4 grid gap-2 md:grid-cols-2">{["A valid government ID (NIN)", "A clear selfie", "Proof of your address, such as a utility bill", "A bank account in your own name", "A guarantor who knows you and your work", "Photos of work you have done", "A phone number to receive job alerts"].map((x) => <li key={x} className="flex gap-3 rounded-2xl bg-white p-3 text-sm"><span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-lime text-xs font-extrabold">✓</span>{x}</li>)}</ul>
        <button onClick={start} className="mt-6 rounded-full bg-brand px-7 py-3.5 font-bold text-white">{session ? "Continue to registration" : "Start your application"}</button></section>
    </div>
  );
}
