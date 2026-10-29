export const JOB_STATUSES = [
  "awaiting_payment", "paid_held", "on_the_way", "arrived", "working",
  "completed_by_provider", "confirmed", "paid_out",
  "cancelled", "disputed", "refunded", "split_resolved",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Allowed moves. The database function enforces the same table; keep both in sync. */
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  awaiting_payment: ["paid_held", "cancelled"],
  paid_held: ["on_the_way", "cancelled", "disputed"],
  on_the_way: ["arrived", "cancelled", "disputed"],
  arrived: ["working", "cancelled", "disputed"],
  working: ["completed_by_provider", "disputed"],
  completed_by_provider: ["confirmed", "disputed"],
  confirmed: ["paid_out"],
  paid_out: [],
  cancelled: ["refunded"],
  disputed: ["refunded", "paid_out", "split_resolved"],
  refunded: [],
  split_resolved: [],
};

export const canTransition = (from: JobStatus, to: JobStatus) => JOB_TRANSITIONS[from].includes(to);

export const REQUEST_STATUSES = ["draft", "open", "offers_received", "accepted", "expired", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
