import { parsePhoneNumber } from "libphonenumber-js";

/**
 * Canonical phone normalizer for the whole app. Returns an E.164 string
 * (e.g. "+972506463464") or null when the input can't be parsed to a valid
 * number. Use this at EVERY write site (CSV import, Apollo, HubSpot, webhook,
 * cache apply) so stored phones are always canonical.
 *
 * It repairs two known upstream defects before parsing:
 *
 *  1. Apollo/HubSpot sometimes return an Israeli number mis-prefixed with "+1"
 *     instead of "+972" (e.g. "+10506463464"). This is safe to repair because
 *     no valid NANP number has "0" as the first digit after the country code,
 *     so "+10…" is never a real US/Canada number. We strip "+1" AND the trunk
 *     "0" — the previous implementation kept the 0 and produced the invalid
 *     "+9720506463464".
 *
 *  2. An extra trunk "0" left after the country code ("+9720…" → "+972…").
 *
 * A genuine non-Israeli number (e.g. a real US "+16505551234") is left intact:
 * the "+1" repair only fires for the unambiguous "+10…" shape, and explicit
 * "+" country codes are honored by libphonenumber.
 */
export function toIsraeliE164(input: string | null | undefined): string | null {
  if (!input || !input.trim()) return null;

  // Strip spaces, dashes, parens, dots, and RTL/LTR marks that sneak in from Hebrew UIs.
  let s = input.replace(/[\s\-().‎‏]/g, "");

  // (1) Repair the Apollo/HubSpot "+1" mis-prefix on Israeli numbers.
  if (/^\+10\d{7,9}$/.test(s)) {
    s = "+972" + s.slice(3); // drop "+1" and the trunk "0"
  }
  // (2) Repair an extra trunk "0" after the +972 country code.
  else if (/^\+9720\d{7,9}$/.test(s)) {
    s = "+972" + s.slice(5);
  }

  try {
    // defaultCountry "IL" resolves bare local numbers ("0506463464", "036463464").
    // Numbers with an explicit "+" country code keep their own country.
    const parsed = parsePhoneNumber(s, "IL");
    if (!parsed?.isValid()) return null;
    return parsed.format("E.164");
  } catch {
    return null;
  }
}
