/**
 * One reader for every shape a provider calls a publication date.
 *
 * serper — the only provider with quota left in August 2026, and therefore the one that
 * served the entire 2026-08-26 scan — reports dates as RELATIVE STRINGS: "2 months ago".
 * Nothing parsed them, and two separate failures came out of that single gap:
 *
 *   1. `new Date("2 months ago")` is an Invalid Date. tech-radar's persist layer passed
 *      it to Prisma unguarded, the write was rejected, and the item was lost.
 *   2. No stage could ask how old an item was. SCAN_WINDOW_DAYS = 30 was passed only to
 *      serpapi and tavily, both at zero quota, so the window went unenforced: all eleven
 *      items written were older than it, the freshest by 56 days, and a 66-day-old story
 *      reached a bank executive introduced with "זה קרה בפועל".
 *
 * Pure, and shared by the age gate and the persist layer so the two can never disagree
 * about what a date means.
 */

/** Days per unit. Months and years are nominal — this decides freshness, not interest. */
const UNIT_DAYS: Record<string, number> = {
  minute: 0,
  min: 0,
  hour: 0,
  hr: 0,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/** "3 days ago", "1 day ago", "45 mins ago", "2 months ago". */
const RELATIVE = /^(\d+)\s*(minute|min|hour|hr|day|week|month|year)s?\s+ago$/i;

/**
 * The publication instant, or null when it cannot be read.
 *
 * Null is a deliberate answer and not an error: an unreadable date is not evidence of
 * freshness, and returning null is what lets the age gate reject the item instead of
 * writing an Invalid Date to the database.
 */
export function parsePublishedAt(raw: string | null | undefined, now: Date = new Date()): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  const rel = RELATIVE.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const days = UNIT_DAYS[rel[2].toLowerCase()];
    if (!Number.isFinite(n) || days === undefined) return null;
    return new Date(now.getTime() - n * days * 864e5);
  }
  if (/^today$/i.test(s)) return new Date(now.getTime());
  if (/^yesterday$/i.test(s)) return new Date(now.getTime() - 864e5);

  const parsed = new Date(s);
  // The whole reason this module exists: an Invalid Date must never leave it.
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole days between publication and now. Null in, null out. */
export function ageInDays(at: Date | null, now: Date = new Date()): number | null {
  if (!at) return null;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 864e5));
}

export type FreshnessSpread = {
  /** Days. Null when nothing had a readable date. */
  freshest: number | null;
  median: number | null;
  oldest: number | null;
  /** Dates that could not be read. Counted, never folded into the numbers. */
  unknown: number;
  counted: number;
};

/**
 * The age profile of a batch, for the scan report.
 *
 * Exists so a stale pool announces itself. Eleven items averaging three months old were
 * indistinguishable, in the 2026-08-26 report, from eleven items published that week —
 * the report simply did not carry the number.
 *
 * All-null on an empty list rather than zero: zeros would read as "everything is fresh".
 */
export function freshnessSpread(raw: (string | null | undefined)[], now: Date = new Date()): FreshnessSpread {
  const ages: number[] = [];
  let unknown = 0;
  for (const r of raw) {
    const age = ageInDays(parsePublishedAt(r, now), now);
    if (age === null) unknown += 1;
    else ages.push(age);
  }
  if (ages.length === 0) return { freshest: null, median: null, oldest: null, unknown, counted: 0 };
  ages.sort((a, b) => a - b);
  return {
    freshest: ages[0],
    median: ages[Math.floor((ages.length - 1) / 2)],
    oldest: ages[ages.length - 1],
    unknown,
    counted: ages.length,
  };
}
