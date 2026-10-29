const TZ = "Africa/Lagos";
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : "";
export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ }) : "";

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function timeLeft(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return "Expired";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min left`;
  if (s < 86400) return `${Math.floor(s / 3600)} h left`;
  return `${Math.floor(s / 86400)} d left`;
}

/** Value for a datetime-local input, in Lagos time, rounded up to the next quarter hour. */
export function defaultSlot(hoursAhead = 24): string {
  const d = new Date(Date.now() + hoursAhead * 3600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  const lagos = new Date(d.getTime() + (1 - -d.getTimezoneOffset() / 60) * 0); // browser local time is used by the input
  return `${lagos.getFullYear()}-${p(lagos.getMonth() + 1)}-${p(lagos.getDate())}T${p(lagos.getHours())}:${p(lagos.getMinutes())}`;
}
