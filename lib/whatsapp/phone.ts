import { parsePhoneNumber } from "libphonenumber-js";

export function normalizePhone(input: string): string | null {
  if (!input?.trim()) return null;
  try {
    const cleaned = input.replace(/[\s\-\(\)\.]/g, "");
    if (!cleaned.startsWith("+")) return null;
    const parsed = parsePhoneNumber(cleaned);
    if (!parsed?.isValid()) return null;
    return parsed.format("E.164");
  } catch {
    return null;
  }
}
