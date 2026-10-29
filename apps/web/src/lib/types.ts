import type { AppRole } from "@connectme/shared";
export type { AppRole };

export interface Profile { id: string; full_name: string | null; phone: string | null; email: string | null; customer_verified: boolean; avatar_path?: string | null; emergency_contact_name?: string | null; emergency_contact_phone?: string | null; sms_alerts?: boolean }
export interface FieldDef { name: string; label: string; type: "text" | "textarea" | "number" | "select" | "multiselect"; required?: boolean; options?: string[] }
export interface Service { id: string; slug: string; name: string; description: string | null; sort_order: number; pricing_mode: "fixed" | "estimate" | "quote"; form_schema: FieldDef[]; inspection_fee_kobo: number; keywords: string[]; credential_requirements: { items: string[]; note: string }; milestone_template?: { label: string; percent: number }[]; job_cap_kobo?: number; active?: boolean }
export interface Area { id: string; name: string; city: string; lat: number; lng: number }
export type ProviderStatus = "draft" | "submitted" | "in_review" | "needs_info" | "approved" | "rejected" | "suspended";
export interface ProviderRow {
  id: string; display_name: string; bio: string | null; years_experience: number | null; base_area_id: string | null;
  radius_km: number; status: ProviderStatus; level: number; available_today: boolean; rating_avg: number; rating_count: number; jobs_completed: number;
}
export interface Progress {
  has_provider: boolean; status?: ProviderStatus; level?: number; case_id?: string | null; decision_note?: string | null; submitted_at?: string | null;
  profile?: boolean; services?: number; nin?: boolean; nin_last4?: string | null; bank?: boolean; bank_name?: string | null; bank_last4?: string;
  id_photo?: boolean; selfie?: boolean; address_doc?: boolean; credentials?: number; guarantor?: boolean; portfolio?: number; references?: number;
  checks?: { type: string; status: "not_checked" | "pending" | "pass" | "fail" | "review" }[];
}
export interface OfferRow {
  offer_id: string; provider_id: string; price_kobo: number; start_at: string | null; message: string | null; created_at: string;
  offer_status: string; display_name: string; avatar_path: string | null; rating_avg: number; rating_count: number; jobs_completed: number;
  years_experience: number | null; level: number; distance_km: number | null; badges: string[]; match_score: number;
}
export interface MyRequest {
  request_id: string; service_name: string; service_slug: string; status: string; area_name: string | null; created_at: string;
  expires_at: string | null; urgent: boolean; offers_count: number; best_price_kobo: number | null; job_id: string | null;
}
export interface InboxRow {
  request_id: string; service_name: string; service_slug: string; details: Record<string, unknown>; area_name: string | null;
  time_slot: string | null; urgent: boolean; budget_kobo: number | null; request_status: string; expires_at: string | null; created_at: string;
  distance_km: number | null; my_offer_id: string | null; my_offer_price_kobo: number | null; my_offer_status: string | null; job_id: string | null;
}
export interface JobListRow { job_id: string; role: "customer" | "provider"; service_name: string; counterpart: string; total_kobo: number; status: string; area_name: string | null; created_at: string; provider_id: string; reviewed: boolean; my_stars: number | null }
export interface MyProvider { provider_id: string; name: string; avatar_path: string | null; services: string[]; service_slugs: string[]; jobs_together: number; last_job_at: string; my_stars: number | null; rating_avg: number; rating_count: number; level: number }
export interface JobView {
  job: { id: string; status: string; total_kobo: number; commission_bps: number; created_at: string };
  role: "customer" | "provider" | "staff"; payout_kobo: number | null;
  service: { name: string; slug: string; pricing_mode: string };
  request: { details: Record<string, unknown>; time_slot: string | null; urgent: boolean; area: string | null };
  address: string | null; door_code: string | null;
  milestones: { id: string; label: string; position: number; amount_kobo: number; status: string }[];
  events: { event: string; note: string | null; at: string }[];
  provider: { id: string; name: string; avatar: string | null; rating: number; rating_count: number; jobs: number; level: number; badges: string[] } | null;
  customer: { first_name: string } | null;
  offer: { message: string | null; start_at: string | null } | null;
  location: { lat: number; lng: number } | null;
  my_review: { stars: number; comment: string | null } | null;
  dispute: { id: string; status: string; reason: string; resolution: string | null; note: string | null } | null;
  trusted_contact: { name: string | null; phone: string | null } | null;
}
export interface PublicProvider {
  id: string; name: string; bio: string | null; years: number | null; avatar: string | null; rating: number; rating_count: number; jobs: number; level: number;
  area: string | null; member_since: string; badges: string[]; services: { name: string; slug: string; typical_price_kobo: number | null }[];
  portfolio: { path: string; caption: string | null }[]; reviews: { stars: number; comment: string | null; at: string; by: string }[];
}
export interface NotificationRow { id: string; type: string; payload: Record<string, unknown>; read_at: string | null; created_at: string }

export interface Earnings {
  held_kobo: number; payable_kobo: number; failed_kobo: number; paid_kobo: number;
  payouts: { id: string; job_id: string; service: string; gross_kobo: number; commission_kobo: number; net_kobo: number; status: string; available_at: string; created_at: string; processed_at: string | null; awaiting_approval: boolean }[];
}
export interface QuoteInfo {
  quote: { id: string; price_kobo: number; scope: string; status: string; valid_until: string; follow_up_job_id: string | null } | null;
  is_quote_service: boolean; can_send: boolean; is_follow_up: boolean;
}
