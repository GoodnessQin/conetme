
export interface InterpretedRequest {
  service: string | null;
  urgent: boolean;
  budgetKobo: number | null;
}

const KEYWORDS: Record<string, string[]> = {
  plumber: ["plumb", "leak", "pipe", "tap", "drain", "toilet", "water heater", "borehole", "pump", "blocked", "sink", "cistern", "flush"],
  caterer: ["cater", "wedding", "party", "buffet", "small chops", "event", "jollof", "birthday", "naming", "cook", "meal", "guests"],
  "solar-installer": ["solar", "inverter", "panel", "batter", "kva", "power backup", "generator cost", "off-grid"],
};

export interface CatalogItem { slug: string; keywords: string[] }

/**
 * Reads a sentence like "Kitchen tap leaking, need someone today, under 25k". Rules only, no AI call.
 * Pass the live service list so services added by admins are recognised too.
 */
export function interpretRequest(text: string, catalog?: CatalogItem[]): InterpretedRequest {
  const t = text.toLowerCase();
  const items: [string, string[]][] = catalog && catalog.length ? catalog.map((c) => [c.slug, c.keywords]) : Object.entries(KEYWORDS);
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const [slug, words] of items) {
    const score = words.reduce((n, w) => n + (w.length > 1 && t.includes(w.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) { best = slug; bestScore = score; tie = false; }
    else if (score === bestScore && score > 0) tie = true;
  }
  const urgent = /\b(today|now|urgent|urgently|asap|immediately|right away|emergency|tonight)\b/.test(t);
  const m = t.match(/(?:under|below|budget(?: of)?|within|less than|max(?:imum)?)\s*(?:₦|ngn|n)?\s*([\d][\d,]*\.?\d*)\s*(k|m|thousand|million)?/);
  let budgetKobo: number | null = null;
  if (m && m[1]) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    const unit = m[2];
    if (unit === "k" || unit === "thousand") n *= 1_000;
    if (unit === "m" || unit === "million") n *= 1_000_000;
    if (Number.isFinite(n) && n > 0) budgetKobo = Math.round(n * 100);
  }
  return { service: tie ? null : best, urgent, budgetKobo };
}
