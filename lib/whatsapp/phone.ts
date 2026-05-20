import { parsePhoneNumber } from "libphonenumber-js";

export function normalizePhone(input: string): string | null {
  if (!input?.trim()) return null;
  try {
    const cleaned = input.replace(/[\s\-\(\)\.]/g, "");
    const withPlus = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
    const parsed = parsePhoneNumber(withPlus);
    if (!parsed?.isValid()) return null;
    return parsed.format("E.164");
  } catch {
    return null;
  }
}
