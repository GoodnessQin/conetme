import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { AlertIcon, BellIcon, CoinIcon, DashboardIcon, GridIcon, HomeIcon, JobsIcon, RequestsIcon, ShieldIcon, UsersIcon, WalletIcon } from "./icons";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

type Mode = "customer" | "provider" | "admin";
type Item = { to: string; label: string; end?: boolean; icon: (p: { size?: number }) => JSX.Element };
const NAV: Record<Mode, Item[]> = {
  customer: [{ to: "/customer", label: "Home", end: true, icon: HomeIcon }, { to: "/customer/requests", label: "Requests", icon: RequestsIcon }, { to: "/customer/jobs", label: "Jobs", icon: JobsIcon }, { to: "/notifications", label: "Alerts", icon: BellIcon }],
  provider: [{ to: "/provider", label: "Dashboard", end: true, icon: DashboardIcon }, { to: "/provider/requests", label: "Requests", icon: RequestsIcon }, { to: "/provider/jobs", label: "Jobs", icon: JobsIcon }, { to: "/provider/earnings", label: "Earnings", icon: WalletIcon }, { to: "/notifications", label: "Alerts", icon: BellIcon }],
  admin: [{ to: "/admin", label: "Verify", end: true, icon: ShieldIcon }, { to: "/admin/people", label: "People", icon: UsersIcon }, { to: "/admin/activity", label: "Activity", icon: RequestsIcon }, { to: "/admin/finance", label: "Finance", icon: CoinIcon }, { to: "/admin/disputes", label: "Disputes", icon: AlertIcon }, { to: "/admin/services", label: "Services", icon: GridIcon }],
};

export function useUnread() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["unread", session?.user.id], enabled: Boolean(session), refetchInterval: 15_000,
    queryFn: async () => {
      const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
      return count ?? 0;
    },
  }).data ?? 0;
}

export function Shell({ children }: { children: ReactNode }) {
  const { profile, roles, isStaff, signOut } = useAuth();
  const loc = useLocation();
  const unread = useUnread();
  const [menu, setMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const mode: Mode = loc.pathname.startsWith("/admin") ? "admin" : loc.pathname.startsWith("/provider") ? "provider" : "customer";
  useEffect(() => { try { localStorage.setItem("cm_mode", mode); } catch { /* private mode */ } setMoreOpen(false); }, [mode, loc.pathname]);
  const bottomItems = mode === "admin" ? NAV.admin.slice(0, 4) : NAV[mode];
  const modes: { id: Mode; label: string; to: string }[] = [{ id: "customer", label: "Customer", to: "/customer" }];
  modes.push({ id: "provider", label: "Provider", to: "/provider" });
  if (isStaff) modes.push({ id: "admin", label: "Admin", to: "/admin" });
  const name = profile?.full_name ?? "Account";
  useEffect(() => { try { localStorage.setItem("cm_mode", mode); } catch { /* private mode */ } }, [mode]);

  return (
    <div className="min-h-screen bg-surface/50 pb-28 md:pb-10">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/app" aria-label="ConnectMe home"><Logo size={26} /></Link>
          <nav className="ml-4 hidden gap-1 md:flex" aria-label="Main">
            {NAV[mode].map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `relative inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${isActive ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
                <n.icon size={18} />{n.label}{n.label === "Alerts" && unread > 0 && <span className="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-white">{unread}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/notifications" aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} className="relative hidden rounded-full p-2 text-muted hover:bg-surface md:block"><BellIcon size={22} />{unread > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">{unread}</span>}</Link>
            {modes.length > 1 && (
              <div className="hidden shrink-0 rounded-full bg-surface p-1 lg:flex" role="group" aria-label="Switch area">
                {modes.map((m) => (
                  <Link key={m.id} to={m.to} aria-current={mode === m.id} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${mode === m.id ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{m.label}</Link>
                ))}
              </div>
            )}
            <div className="relative">
              <button onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label="Account menu" className="flex items-center gap-2 rounded-full"><Avatar name={name} path={profile?.avatar_path} size={36} /><span className="hidden max-w-[120px] truncate text-sm font-bold md:inline">{name.split(" ")[0]}</span></button>
              {menu && (
                <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-line bg-white p-2 shadow-xl" onMouseLeave={() => setMenu(false)}>
                  <p className="truncate px-3 py-2 text-sm font-bold">{name}</p>
                  <p className="truncate px-3 pb-2 text-xs text-muted">{profile?.phone ? `+${profile.phone.replace(/^\+/, "")}` : ""}</p>
                  <div className="border-t border-line pt-1 lg:hidden">
                    {modes.map((m) => <Link key={m.id} to={m.to} onClick={() => setMenu(false)} className="block rounded-xl px-3 py-2 text-sm hover:bg-surface">{m.id === "provider" && !roles.includes("provider") ? "Become a provider" : m.label}</Link>)}
                  </div>
                  {mode === "provider" && roles.includes("provider") && <Link to="/provider/profile" onClick={() => setMenu(false)} className="block rounded-xl px-3 py-2 text-sm font-medium hover:bg-surface">Provider profile</Link>}
                  <Link to="/account" onClick={() => setMenu(false)} className="block rounded-xl px-3 py-2 text-sm font-medium hover:bg-surface">{mode === "provider" ? "Account and alerts" : "My account"}</Link>
                  <button onClick={signOut} className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-danger hover:bg-surface">Log out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      <nav aria-label="Main" className="fixed inset-x-3 bottom-3 z-30 md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {moreOpen && mode === "admin" && (
          <div className="mb-2 rounded-3xl border border-line bg-white p-2 shadow-[0_8px_30px_rgba(11,16,32,0.14)]">
            {[...NAV.admin.slice(4), { to: "/notifications", label: "Alerts", icon: BellIcon }].map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-ink hover:bg-surface"><n.icon size={20} />{n.label}</Link>
            ))}
          </div>
        )}
        <div className="grid rounded-[28px] border border-line bg-white/95 px-1.5 py-1 shadow-[0_8px_30px_rgba(11,16,32,0.14)] backdrop-blur" style={{ gridTemplateColumns: `repeat(${bottomItems.length + (mode === "admin" ? 1 : 0)}, 1fr)` }}>
          {bottomItems.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `relative flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-bold transition ${isActive ? "text-brand" : "text-muted"}`}>
              {({ isActive }) => (<>
                <span className={isActive ? "scale-110" : ""}><n.icon size={22} /></span>
                <span>{n.label}</span>
                {n.label === "Alerts" && unread > 0 && <span className="absolute right-[26%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-extrabold text-white">{unread}</span>}
              </>)}
            </NavLink>
          ))}
          {mode === "admin" && <button onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-bold ${moreOpen ? "text-brand" : "text-muted"}`}><GridIcon size={22} /><span>More</span></button>}
        </div>
      </nav>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <p role="status" className="py-16 text-center text-muted">{label}…</p>;
}
export function Notice({ children }: { children: ReactNode }) {
  return <div className="card text-sm text-muted">{children}</div>;
}
