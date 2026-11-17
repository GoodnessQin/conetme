import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Logo } from "./Logo";
import { MenuIcon } from "./icons";

const LINKS: [string, string][] = [["/", "Explore"], ["/browse", "Providers"], ["/faq", "Help"], ["/become-a-provider", "Become a provider"]];

/** The front door for visitors: browse everything, no account needed. */
export function PublicShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" aria-label="ConnectMe home"><Logo size={24} /></Link>
          <nav className="ml-6 hidden gap-1 md:flex" aria-label="Main">
            {LINKS.map(([to, label]) => (
              <NavLink key={to} to={to} end className={({ isActive }) => `rounded-full px-3 py-2 text-sm font-semibold ${isActive ? "text-brand" : "text-muted hover:text-ink"}`}>{label}</NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/sign-in" className="hidden rounded-full px-4 py-2 text-sm font-bold text-brand md:block">Log in</Link>
            <Link to="/sign-in" className="hidden rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white md:block">Sign up</Link>
            <Link to="/sign-in" className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-white md:hidden">Sign in</Link>
            <button className="rounded-full p-2 md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><MenuIcon size={22} /></button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-line bg-white px-4 py-2 md:hidden" aria-label="Menu">
            {LINKS.map(([to, label]) => <Link key={to} to={to} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-sm font-semibold hover:bg-surface">{label}</Link>)}
          </nav>
        )}
      </header>
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-4">
        <div className="md:col-span-2"><Logo size={24} /><p className="mt-3 max-w-sm text-sm text-muted">Verified plumbers, caterers and solar installers across Nigeria. You pay through ConnectMe, and the provider is paid only after you confirm the work.</p></div>
        <div className="text-sm"><p className="font-bold">ConnectMe</p>
          <ul className="mt-2 space-y-1.5 text-muted"><li><Link to="/browse" className="hover:text-brand">Find a provider</Link></li><li><Link to="/become-a-provider" className="hover:text-brand">Become a provider</Link></li><li><Link to="/faq" className="hover:text-brand">Help and FAQ</Link></li></ul></div>
        <div className="text-sm"><p className="font-bold">Need help?</p><p className="mt-2 text-muted">support@connectme.ng</p><ul className="mt-2 space-y-1.5 text-muted"><li><Link to="/legal/terms" className="hover:text-brand">Terms</Link></li><li><Link to="/legal/privacy" className="hover:text-brand">Privacy</Link></li><li><Link to="/legal/safety" className="hover:text-brand">Safety Code</Link></li></ul></div>
      </div>
      <p className="border-t border-line py-4 text-center text-xs text-muted">© {new Date().getFullYear()} ConnectMe. Made in Nigeria.</p>
    </footer>
  );
}
