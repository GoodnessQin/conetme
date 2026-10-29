import { describe, expect, it } from "vitest";
import { allocateMilestones, formatNaira, splitCommission, normalizeNgPhone, canTransition, rankScore, phoneSchema } from "./index";

describe("money", () => {
  it("splits 10% commission on 20,000 naira", () => {
    expect(splitCommission(2_000_000, 1000)).toEqual({ commission: 200_000, payout: 1_800_000 });
  });
  it("commission + payout always equals amount", () => {
    for (const a of [1, 33, 9999, 1_234_567]) {
      const { commission, payout } = splitCommission(a, 1000);
      expect(commission + payout).toBe(a);
    }
  });
  it("rejects bad input", () => {
    expect(() => splitCommission(10.5, 1000)).toThrow();
    expect(() => splitCommission(100, 20000)).toThrow();
  });
  it("milestones sum exactly to total", () => {
    const parts = allocateMilestones(2_400_001, [40, 40, 20]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(2_400_001);
    expect(parts).toHaveLength(3);
  });
  it("formats naira", () => {
    expect(formatNaira(1_200_000)).toBe("₦12,000");
  });
});

describe("phone", () => {
  it.each(["08031234567", "8031234567", "+2348031234567", "234 803 123 4567"])("accepts %s", (v) => {
    expect(normalizeNgPhone(v)).toBe("+2348031234567");
  });
  it.each(["12345", "0603123456", "+1555123456"])("rejects %s", (v) => {
    expect(normalizeNgPhone(v)).toBeNull();
  });
  it("schema normalises", () => {
    expect(phoneSchema.parse("0803 123 4567")).toBe("+2348031234567");
  });
});

describe("job state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("awaiting_payment", "paid_held")).toBe(true);
    expect(canTransition("completed_by_provider", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "paid_out")).toBe(true);
  });
  it("blocks skipping steps", () => {
    expect(canTransition("paid_held", "paid_out")).toBe(false);
    expect(canTransition("awaiting_payment", "working")).toBe(false);
  });
});

describe("ranking", () => {
  const base = { rating: 4.8, distanceKm: 2, radiusKm: 10, availableNow: true, sameDay: true, jobsCompleted: 40, responseRate: 1 };
  it("prefers closer, better rated providers", () => {
    expect(rankScore(base)).toBeGreaterThan(rankScore({ ...base, rating: 3.5, distanceKm: 8 }));
  });
  it("penalises ignored requests", () => {
    expect(rankScore(base)).toBeGreaterThan(rankScore({ ...base, responseRate: 0.4 }));
  });
});

import { interpretRequest } from "./index";
describe("interpretRequest", () => {
  it("reads service, urgency and budget", () => {
    expect(interpretRequest("Leaking pipe in my kitchen, urgent, under 25k")).toEqual({ service: "plumber", urgent: true, budgetKobo: 2_500_000 });
  });
  it("recognises caterers and solar", () => {
    expect(interpretRequest("Need small chops and jollof for 80 guests at my wedding").service).toBe("caterer");
    expect(interpretRequest("Install a 5kva inverter and batteries").service).toBe("solar-installer");
  });
  it("returns null when unsure", () => {
    expect(interpretRequest("help me please").service).toBeNull();
  });
  it("reads millions", () => {
    expect(interpretRequest("solar for my house budget 2.5 million").budgetKobo).toBe(250_000_000);
  });
});

describe("interpretRequest with a live catalog", () => {
  const catalog = [{ slug: "plumber", keywords: ["plumb", "leak"] }, { slug: "hair-stylist", keywords: ["hair", "braid", "stylist"] }];
  it("recognises a service an admin added", () => {
    expect(interpretRequest("I want a hair stylist", catalog).service).toBe("hair-stylist");
  });
  it("returns null for a service nobody offers", () => {
    expect(interpretRequest("I need a mechanic for my car", catalog).service).toBeNull();
  });
});
