/** All money is integer kobo (1 NGN = 100 kobo). Never use decimals for money. */
export type Kobo = number;

export const nairaToKobo = (naira: number): Kobo => Math.round(naira * 100);

export function formatNaira(kobo: Kobo): string {
  const naira = kobo / 100;
  const hasKobo = kobo % 100 !== 0;
  return "₦" + naira.toLocaleString("en-NG", {
    minimumFractionDigits: hasKobo ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Commission rate is stored in basis points (1000 bps = 10%). */
export function splitCommission(amount: Kobo, rateBps: number) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("amount must be a non-negative integer (kobo)");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new Error("rateBps must be 0..10000");
  const commission = Math.round((amount * rateBps) / 10_000);
  return { commission, payout: amount - commission };
}

/** Split a total across milestones by percent. Parts always sum exactly to total. */
export function allocateMilestones(total: Kobo, percents: number[]): Kobo[] {
  if (percents.reduce((a, b) => a + b, 0) !== 100) throw new Error("percents must sum to 100");
  const parts = percents.map((p) => Math.floor((total * p) / 100));
  const diff = total - parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] = (parts[parts.length - 1] ?? 0) + diff;
  return parts;
}
