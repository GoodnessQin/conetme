import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { STAFF_ROLES, type AppRole } from "@connectme/shared";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  isStaff: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const lastUser = useRef<string | null>(null);

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setRoles([]);
      return;
    }
    const [p, r] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone, email, customer_verified, avatar_path, emergency_contact_name, emergency_contact_phone, sms_alerts").eq("id", s.user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", s.user.id),
    ]);
    setProfile((p.data as Profile | null) ?? null);
    setRoles(((r.data ?? []) as { role: AppRole }[]).map((x) => x.role));
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      lastUser.current = data.session?.user.id ?? null;
      setSession(data.session);
      await load(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      const uid = s?.user.id ?? null;
      // A different person just signed in: wait for their profile before any screen decides where to send them.
      // (Token refreshes for the same person do not show a loading state.)
      if (uid && uid !== lastUser.current) setLoading(true);
      lastUser.current = uid;
      // defer: never call supabase inside the auth callback directly
      setTimeout(() => { void load(s).finally(() => { if (active) setLoading(false); }); }, 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      roles,
      isStaff: roles.some((r) => STAFF_ROLES.includes(r)),
      loading,
      refresh: () => load(session),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, profile, roles, loading, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
