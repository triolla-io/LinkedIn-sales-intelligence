import { sampleJitterSeconds } from "@/lib/extension/send-jitter";

type Input = {
  timezone: string;          // IANA, e.g. "Asia/Jerusalem"
  workingHoursStart: number; // 0-23
  workingHoursEnd: number;   // 0-23
  /** Minute offset within the start/end hour (e.g. end 21:30 = hoursEnd 21 + minutesEnd 30). Defaults to 0. */
  workingMinutesStart?: number;
  workingMinutesEnd?: number;
  weekdaysOnly: boolean;
  /** Weekday numbers that count as working days (0=Sun … 6=Sat). Defaults to Mon-Fri [1-5]. */
  workingWeekdays?: number[];
  lastSentAt: Date | null;
  sentTodayCount: number;
  sentLastHourCount: number;
  dailyCap: number;
  hourlyCap: number;
  /**
   * Opt-in gentle pacing (connection requests): today's drawn send target.
   * When set — gaps become dynamic (remaining window ÷ remaining quota,
   * Gaussian ±35%, 15-min floor) and day starts are softened by 10–45 min.
   * Absent = legacy behavior (sequence SENDs must stay unchanged).
   */
  dailyTarget?: number;
  /** Injectable randomness for tests. Defaults to Math.random. */
  rng?: () => number;
};

const MIN_GAP_MIN = 3;
const MAX_GAP_MIN = 10;
const DYNAMIC_MIN_GAP_MIN = 15;
const SOFT_START_MIN_OFFSET_MIN = 10;
const SOFT_START_MAX_OFFSET_MIN = 45;

export function computeNextScheduledFor(input: Input): Date {
  const now = new Date();
  const rng = input.rng ?? Math.random;

  const dailyLimit = Math.min(input.dailyTarget ?? input.dailyCap, input.dailyCap);
  if (input.sentTodayCount >= dailyLimit) {
    return nextWorkdayStart(now, input, rng);
  }
  if (input.sentLastHourCount >= input.hourlyCap) {
    return roundUpToNextHour(now);
  }

  // First ever send — schedule immediately so the extension picks it up in the next poll cycle.
  if (input.lastSentAt === null) {
    return clampToWorkingHours(now, input, rng);
  }

  const candidate =
    input.dailyTarget !== undefined
      ? new Date(now.getTime() + dynamicGapMinutes(now, input, rng) * 60_000)
      : addRandomMinutes(now, MIN_GAP_MIN, MAX_GAP_MIN, rng);
  return clampToWorkingHours(candidate, input, rng);
}

/**
 * Dynamic gap: remaining window ÷ remaining quota, Gaussian-jittered ±35%,
 * floored at 15 min — spreads the day's sends across the whole window with
 * an irregular rhythm instead of a morning burst.
 */
function dynamicGapMinutes(now: Date, input: Input, rng: () => number): number {
  const local = toZonedParts(now, input.timezone);
  const endMin = input.workingHoursEnd * 60 + (input.workingMinutesEnd ?? 0);
  const remainingWindow = Math.max(0, endMin - local.minuteOfDay);
  const remainingQuota = Math.max(1, (input.dailyTarget ?? input.dailyCap) - input.sentTodayCount);
  const target = remainingWindow / remainingQuota;
  const min = Math.max(DYNAMIC_MIN_GAP_MIN, target * 0.65);
  const max = Math.max(min, target * 1.35);
  // sampleJitterSeconds is unit-agnostic (mean/sd/clamp) — feeding minutes returns minutes.
  return sampleJitterSeconds({ minSeconds: min, maxSeconds: max, source: "default" }, rng);
}

/**
 * Soft day start (gentle mode only): never open fire at the window boundary
 * exactly — a 9:00:00.000 first send every day is a robotic signature.
 * Offset is clamped to half the window for very short windows.
 */
function softStartOffsetMin(input: Input, rng: () => number): number {
  if (input.dailyTarget === undefined) return 0;
  const startMin = input.workingHoursStart * 60 + (input.workingMinutesStart ?? 0);
  const endMin = input.workingHoursEnd * 60 + (input.workingMinutesEnd ?? 0);
  const maxOffset = Math.min(SOFT_START_MAX_OFFSET_MIN, Math.max(0, (endMin - startMin) / 2));
  const minOffset = Math.min(SOFT_START_MIN_OFFSET_MIN, maxOffset);
  return minOffset + rng() * (maxOffset - minOffset);
}

function addRandomMinutes(from: Date, min: number, max: number, rng: () => number): Date {
  const ms = (min + rng() * (max - min)) * 60_000;
  return new Date(from.getTime() + ms);
}

function roundUpToNextHour(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  out.setUTCHours(out.getUTCHours() + 1);
  return out;
}

function isWorkingDay(weekday: number, input: Input): boolean {
  const days = input.workingWeekdays ?? [1, 2, 3, 4, 5];
  return days.includes(weekday);
}

function clampToWorkingHours(d: Date, input: Input, rng: () => number): Date {
  const local = toZonedParts(d, input.timezone);
  const startMin = input.workingHoursStart * 60 + (input.workingMinutesStart ?? 0);
  const endMin = input.workingHoursEnd * 60 + (input.workingMinutesEnd ?? 0);
  const inHours = local.minuteOfDay >= startMin && local.minuteOfDay < endMin;
  if (inHours && (!input.weekdaysOnly || isWorkingDay(local.weekday, input))) return d;
  return nextWorkdayStart(d, input, rng);
}

/** True when `d` falls on an allowed weekday and inside [start, end) hours, in `timezone`. */
export function isWithinWindow(
  d: Date,
  w: {
    timezone: string;
    workingHoursStart: number;
    workingHoursEnd: number;
    workingMinutesStart?: number;
    workingMinutesEnd?: number;
    workingWeekdays: number[];
  }
): boolean {
  const parts = toZonedParts(d, w.timezone);
  const startMin = w.workingHoursStart * 60 + (w.workingMinutesStart ?? 0);
  const endMin = w.workingHoursEnd * 60 + (w.workingMinutesEnd ?? 0);
  return (
    w.workingWeekdays.includes(parts.weekday) &&
    parts.minuteOfDay >= startMin &&
    parts.minuteOfDay < endMin
  );
}

function nextWorkdayStart(from: Date, input: Input, rng: () => number): Date {
  const cursor = new Date(from);
  const startHour = input.workingHoursStart;
  const startMinute = input.workingMinutesStart ?? 0;
  // Today still counts if its working window hasn't opened yet.
  const today = toZonedParts(cursor, input.timezone);
  const todayIsWorkday = !input.weekdaysOnly || isWorkingDay(today.weekday, input);
  if (todayIsWorkday && today.minuteOfDay < startHour * 60 + startMinute) {
    const start = setHourInZone(cursor, input.timezone, startHour, startMinute);
    return new Date(start.getTime() + softStartOffsetMin(input, rng) * 60_000);
  }
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (true) {
    const parts = toZonedParts(cursor, input.timezone);
    if (!input.weekdaysOnly || isWorkingDay(parts.weekday, input)) {
      const start = setHourInZone(cursor, input.timezone, startHour, startMinute);
      return new Date(start.getTime() + softStartOffsetMin(input, rng) * 60_000);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

function toZonedParts(d: Date, tz: string): { hour: number; minuteOfDay: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour, minuteOfDay: hour * 60 + minute, weekday: map[wd] };
}

/** The UTC instant of local midnight (00:00) of `d`'s calendar date in `tz`. */
export function startOfDayInZone(d: Date, tz: string): Date {
  return setHourInZone(d, tz, 0);
}

function setHourInZone(d: Date, tz: string, hour: number, minute = 0): Date {
  // Get the local calendar date in the target timezone
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

  // Start from UTC midnight of that local date
  const utcMidnight = new Date(`${ymd}T00:00:00Z`);

  // Find what local hour UTC midnight maps to in the target timezone
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  });
  const localHourAtMidnight = Number(fmt.formatToParts(utcMidnight).find(p => p.type === "hour")!.value) % 24;

  // Shift from midnight to the desired local hour + minute
  const deltaHours = hour - localHourAtMidnight;
  return new Date(utcMidnight.getTime() + deltaHours * 3_600_000 + minute * 60_000);
}
