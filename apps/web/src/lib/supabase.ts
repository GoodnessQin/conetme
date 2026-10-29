import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anon);

// A placeholder URL keeps the app rendering (with a setup notice) when .env.local is missing.
export const supabase = createClient(url ?? "http://localhost:54321", anon ?? "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true },
});
