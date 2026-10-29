import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "../auth/AuthProvider";
import type { Area, ProviderRow, Service } from "./types";

export function useServices() {
  return useQuery({
    queryKey: ["services"], staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("id, slug, name, description, sort_order, pricing_mode, form_schema, inspection_fee_kobo, keywords, credential_requirements, milestone_template, job_cap_kobo, active").order("sort_order");
      if (error) throw error;
      return data as Service[];
    },
  });
}
export function useAreas() {
  return useQuery({
    queryKey: ["areas"], staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_areas");
      if (error) throw error;
      return data as Area[];
    },
  });
}
export function useMyProvider() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["my-provider", session?.user.id], enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase.from("providers")
        .select("id, display_name, bio, years_experience, base_area_id, radius_km, status, level, available_today, rating_avg, rating_count, jobs_completed")
        .eq("user_id", session!.user.id).maybeSingle();
      if (error) throw error;
      return data as ProviderRow | null;
    },
  });
}
export function useCommissionBps() {
  return useQuery({
    queryKey: ["commission"], staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "commission_bps").maybeSingle();
      return Number(data?.value ?? 1000);
    },
  }).data ?? 1000;
}
export function useTestPayments() {
  return useQuery({
    queryKey: ["test-payments"], staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "test_payments").maybeSingle();
      return data?.value === true;
    },
  }).data ?? false;
}

export function usePaymentMode(): "test" | "paystack" {
  return useQuery({
    queryKey: ["payment-mode"], staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "payment_mode").maybeSingle();
      return String(data?.value ?? "test").replace(/"/g, "") === "paystack" ? ("paystack" as const) : ("test" as const);
    },
  }).data ?? "test";
}
