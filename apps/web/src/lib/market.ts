import { useQuery } from "@tanstack/react-query";
import { rpc } from "./api";
import { supabase } from "./supabase";
import type { MarketBanner, MarketCard } from "./types";

export interface MarketFilters { state?: string; area?: string; service?: string; q?: string; sort?: string; limit?: number }
export function useMarket(f: MarketFilters, enabled = true) {
  return useQuery({
    queryKey: ["market", f], enabled, staleTime: 30_000,
    queryFn: () => rpc<MarketCard[]>("marketplace_providers", { p_state: f.state || null, p_area_id: f.area || null, p_service_slug: f.service || null, p_query: f.q || null, p_sort: f.sort || "top", p_limit: f.limit ?? 24, p_offset: 0 }),
  });
}
export function useBanners() {
  return useQuery({
    queryKey: ["banners"], staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_banners").select("id, title, subtitle, image_path, link, sort_order, active").eq("active", true).order("sort_order");
      if (error) throw error;
      return data as MarketBanner[];
    },
  });
}
