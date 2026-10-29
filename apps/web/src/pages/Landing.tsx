import { Link, Navigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth/AuthProvider";
import { LegalLinks } from "./Legal";

export default function Landing() {
  const { session, loading } = useAuth();
  if (!loading && session) return <Navigate to="/app" replace />;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-8">
      <div className="flex items-center justify-between"><Logo size={32} /><Link to="/sign-in?mode=login" className="text-sm font-bold text-brand">Log in</Link></div>
      <div className="my-auto py-12">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight">Verified pros, at your door.</h1>
        <p className="mt-4 text-lg text-muted">Post what you need. Verified plumbers, caterers and solar installers send you offers. You compare, choose, and pay only when the job is done.</p>
        <ul className="mt-6 space-y-2.5">
          {["Every provider is ID-checked, with a guarantor and references", "Your money is held until you confirm the work", "A door code tells you who is who"].map((t) => (
            <li key={t} className="flex gap-3"><span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-lime text-xs font-extrabold">✓</span>{t}</li>
          ))}
        </ul>
      </div>
      <Link to="/sign-in?mode=signup" className="btn">Create account</Link>
      <Link to="/sign-in?mode=login" className="btn btn-ghost mt-3">Log in</Link>
      <p className="mt-4 text-center text-sm text-muted">You sign in with your phone number and a code we text you. No password to remember.</p>
      <LegalLinks className="mt-3 text-center" />
    </main>
  );
}
