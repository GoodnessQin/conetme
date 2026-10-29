import { z } from "zod";
import { normalizeNgPhone } from "./phone";

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = normalizeNgPhone(v);
    if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid Nigerian phone number" });
    return p ?? "";
  });

export const otpSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

export const fullNameSchema = z
  .string()
  .trim()
  .min(3, "Enter your full name")
  .max(80)
  .refine((v) => v.includes(" "), "Enter first and last name");

export const SERVICE_SLUGS = ["plumber", "caterer", "solar-installer"] as const;
export type ServiceSlug = (typeof SERVICE_SLUGS)[number];

export const APP_ROLES = ["customer", "provider", "verifier", "support", "finance", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const STAFF_ROLES: AppRole[] = ["verifier", "support", "finance", "admin"];
