export interface RankInput {
  rating: number;            // 0..5
  distanceKm: number;
  radiusKm: number;
  availableNow: boolean;
  sameDay: boolean;
  jobsCompleted: number;
  responseRate: number;      // 0..1
  priceKobo?: number;
  budgetKobo?: number;
}

/** Weights from the project doc: rating 34, distance 28, availability 22, jobs 10, base 6. */
export function rankScore(i: RankInput): number {
  const rating = (i.rating / 5) * 34;
  const distance = Math.max(0, 1 - i.distanceKm / Math.max(i.radiusKm, 1)) * 28;
  const availability = (i.sameDay ? (i.availableNow ? 1 : 0) : 0.7) * 22;
  const jobs = Math.min(i.jobsCompleted / 50, 1) * 10;
  const base = 6;
  let score = rating + distance + availability + jobs + base;
  // new providers get a small boost so they can win their first jobs
  if (i.jobsCompleted < 3) score += 4;
  // ignoring requests lowers rank
  score -= (1 - i.responseRate) * 10;
  if (i.priceKobo && i.budgetKobo) {
    score += i.priceKobo <= i.budgetKobo ? 4 : -8;
  }
  return Math.round(score * 100) / 100;
}
