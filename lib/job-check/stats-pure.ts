import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Pure, client-safe helpers for job-change stats.
// No prisma / server-only imports here so this module can be imported from Client Components
// without pulling `pg` (and Node built-ins like dns/fs/net) into the browser bundle.

export const CADENCE_DAYS = 28;
export const DAY_MS = 86_400_000;
/** ~100 Apollo/night + up to 167 Bright Data/day; informational estimate for the rate line. */
export const DAILY_THROUGHPUT_ESTIMATE = 267;
export const TZ = "Asia/Jerusalem";

/** UTC instant of the 1st of the current calendar month in Israel time. */
export function startOfMonthTLV(now: Date): Date {
  const yyyyMM = formatInTimeZone(now, TZ, "yyyy-MM");
  return fromZonedTime(`${yyyyMM}-01T00:00:00`, TZ);
}

export function nextCheckAt(last: Date): Date {
  return new Date(last.getTime() + CADENCE_DAYS * DAY_MS);
}

export function isDueNow(last: Date | null, now: Date): boolean {
  if (!last) return true;
  return now.getTime() - last.getTime() >= CADENCE_DAYS * DAY_MS;
}

export function coveragePct(covered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((covered / total) * 100);
}

export function estimateFullPassDays(dueNow: number, throughput: number): number {
  if (dueNow <= 0 || throughput <= 0) return 0;
  return Math.ceil(dueNow / throughput);
}

export function eligibleContactWhere(ownerId: string) {
  return { ownerId, removedAt: null, linkedinUrl: { not: "" } } as const;
}
