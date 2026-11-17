import { supabase } from "./supabase";

/** Where to send someone after they sign in, kept across the sign-in redirect (also across Google's round trip). */
const NEXT = "cm_next";
const INTENT = "cm_intent";
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* private mode */ } },
};
export const rememberNext = (path: string) => { if (path.startsWith("/") && !path.startsWith("//")) store.set(NEXT, path); };
export const peekNext = () => store.get(NEXT);
export function takeNext(): string | null { const v = store.get(NEXT); store.del(NEXT); return v && v.startsWith("/") && !v.startsWith("//") ? v : null; }
export const peekIntent = (): "customer" | "provider" | null => { const v = store.get(INTENT); return v === "provider" ? "provider" : v === "customer" ? "customer" : null; };
export const rememberIntent = (i: "customer" | "provider") => store.set(INTENT, i);
export function takeIntent(): "customer" | "provider" | null { const v = store.get(INTENT); store.del(INTENT); return v === "provider" ? "provider" : v === "customer" ? "customer" : null; }

export async function signInWithGoogle(): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/app` } });
  if (!error) return null;
  return /not enabled|unsupported provider/i.test(error.message) ? "Google sign-in is not switched on yet. Use your phone number for now." : "We could not start Google sign-in. Try again, or use your phone number.";
}

export const providerUrl = (slug: string) => `${window.location.origin}/pro/${slug}`;

export async function shareLink(title: string, text: string, url: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return "shared"; }
  } catch (e) { if ((e as Error).name === "AbortError") return "failed"; }
  try { await navigator.clipboard.writeText(url); return "copied"; } catch { return "failed"; }
}
