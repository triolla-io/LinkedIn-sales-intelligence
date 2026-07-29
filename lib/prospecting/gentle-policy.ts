// Platform-owned "gentleness" policy for LinkedIn connection requests.
// Hard caps, warm-up ladder, and the per-day send target.
// Pure module — no prisma imports (client bundles may reach it transitively).

export const HARD_DAILY_CAP = 12;
export const HARD_WEEKLY_CAP = 60;
export const CONNECT_HOURLY_CAP = 3;

/** Week (1-based) → caps while the account warms up. Index 3 = mature. */
export const WARMUP_LADDER = [
  { daily: 3, weekly: 15 },
  { daily: 5, weekly: 25 },
  { daily: 8, weekly: 40 },
  { daily: HARD_DAILY_CAP, weekly: HARD_WEEKLY_CAP },
] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_TARGET_MIN_FACTOR = 0.7;

/** 1-based warm-up week. Null anchor (no successful send yet) = week 1 — most conservative. */
export function warmupWeek(startedAt: Date | null, now: Date): number {
  if (!startedAt) return 1;
  const weeks = Math.floor((now.getTime() - startedAt.getTime()) / WEEK_MS);
  return Math.max(1, weeks + 1);
}

function warmupCaps(week: number): { daily: number; weekly: number } {
  return WARMUP_LADDER[Math.min(Math.max(week, 1), WARMUP_LADDER.length) - 1];
}

/**
 * The caps that actually apply right now:
 * min(run-configured cap, warm-up ladder for the account's age, platform hard cap).
 */
export function effectiveCaps(input: {
  runDailyCap: number;
  runWeeklyCap: number;
  warmupStartedAt: Date | null;
  now: Date;
}): { dailyCap: number; weeklyCap: number; week: number; warming: boolean } {
  const week = warmupWeek(input.warmupStartedAt, input.now);
  const warm = warmupCaps(week);
  return {
    dailyCap: Math.min(input.runDailyCap, warm.daily, HARD_DAILY_CAP),
    weeklyCap: Math.min(input.runWeeklyCap, warm.weekly, HARD_WEEKLY_CAP),
    week,
    warming: week < WARMUP_LADDER.length,
  };
}

/** Local calendar date key ("2026-07-29") in tz — same "today" as startOfDayInZone. */
export function localDateKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// FNV-1a 32-bit — cheap deterministic hash, no crypto needed.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Today's actual send target: 70%–100% of the effective daily cap, drawn
 * deterministically from (userId, local calendar date) — every scheduling call
 * within the same day agrees, with no stored state. A mature account sends
 * 8–12/day, never a flat 12 every day.
 */
export function dailyTargetFor(input: {
  userId: string;
  timezone: string;
  now: Date;
  effectiveDailyCap: number;
}): number {
  const seed = fnv1a(`${input.userId}:${localDateKey(input.now, input.timezone)}`);
  const factor = DAY_TARGET_MIN_FACTOR + (1 - DAY_TARGET_MIN_FACTOR) * (seed / 0xffffffff);
  return Math.max(1, Math.round(input.effectiveDailyCap * factor));
}

/** Clamp client-supplied run caps to the platform hard caps (API create path). */
export function clampRunCaps(input: { dailyCap?: number; weeklyCap?: number }): {
  dailyCap?: number;
  weeklyCap?: number;
} {
  return {
    dailyCap: input.dailyCap !== undefined ? Math.min(input.dailyCap, HARD_DAILY_CAP) : undefined,
    weeklyCap: input.weeklyCap !== undefined ? Math.min(input.weeklyCap, HARD_WEEKLY_CAP) : undefined,
  };
}
