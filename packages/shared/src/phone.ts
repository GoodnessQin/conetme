/** Normalise Nigerian phone numbers to E.164 (+234XXXXXXXXXX). Returns null if invalid. */
export function normalizeNgPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let national: string;
  if (digits.startsWith("+234")) national = digits.slice(4);
  else if (digits.startsWith("234")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  if (!/^[789][01]\d{8}$/.test(national)) return null;
  return "+234" + national;
}
