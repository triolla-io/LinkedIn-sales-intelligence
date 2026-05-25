import { parsePhoneNumber } from "libphonenumber-js";

export function normalizePhone(input: string): string | null {
  if (!input?.trim()) return null;
  try {
    const cleaned = input.replace(/[\s\-\(\)\.]/g, "");
    const withPrefix = cleaned.startsWith("+") ? cleaned : `+972${cleaned.replace(/^0/, "")}`;
    const parsed = parsePhoneNumber(withPrefix);
    if (!parsed?.isValid()) return null;
    return parsed.format("E.164");
  } catch {
    return null;
  }
}
