type Input = {
  timezone: string;          // IANA, e.g. "Asia/Jerusalem"
  workingHoursStart: number; // 0-23
  workingHoursEnd: number;   // 0-23
  weekdaysOnly: boolean;
  /** Weekday numbers that count as working days (0=Sun … 6=Sat). Defaults to Mon-Fri [1-5]. */
  workingWeekdays?: number[];
  lastSentAt: Date | null;
  sentTodayCount: number;
  sentLastHourCount: number;
  dailyCap: number;
  hourlyCap: number;
};

const MIN_GAP_MIN = 3;
const MAX_GAP_MIN = 10;

export function computeNextScheduledFor(input: Input): Date {
  const now = new Date();

  if (input.sentTodayCount >= input.dailyCap) {
    return nextWorkdayStart(now, input);
  }
  if (input.sentLastHourCount >= input.hourlyCap) {
    return roundUpToNextHour(now);
  }

  // First ever send — schedule immediately so the extension picks it up in the next poll cycle.
  if (input.lastSentAt === null) {
    return clampToWorkingHours(now, input);
  }

  const candidate = addRandomMinutes(now, MIN_GAP_MIN, MAX_GAP_MIN);
  return clampToWorkingHours(candidate, input);
}

function addRandomMinutes(from: Date, min: number, max: number): Date {
  const ms = (min + Math.random() * (max - min)) * 60_000;
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

function clampToWorkingHours(d: Date, input: Input): Date {
  const local = toZonedParts(d, input.timezone);
  const inHours = local.hour >= input.workingHoursStart && local.hour < input.workingHoursEnd;
  if (inHours && (!input.weekdaysOnly || isWorkingDay(local.weekday, input))) return d;
  return nextWorkdayStart(d, input);
}

function nextWorkdayStart(from: Date, input: Input): Date {
  const cursor = new Date(from);
  // Today still counts if its working window hasn't opened yet.
  const today = toZonedParts(cursor, input.timezone);
  const todayIsWorkday = !input.weekdaysOnly || isWorkingDay(today.weekday, input);
  if (todayIsWorkday && today.hour < input.workingHoursStart) {
    return setHourInZone(cursor, input.timezone, input.workingHoursStart);
  }
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (true) {
    const parts = toZonedParts(cursor, input.timezone);
    if (!input.weekdaysOnly || isWorkingDay(parts.weekday, input)) {
      return setHourInZone(cursor, input.timezone, input.workingHoursStart);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

function toZonedParts(d: Date, tz: string): { hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour, weekday: map[wd] };
}

function setHourInZone(d: Date, tz: string, hour: number): Date {
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

  // Shift from midnight to the desired local hour
  const deltaHours = hour - localHourAtMidnight;
  return new Date(utcMidnight.getTime() + deltaHours * 3_600_000);
}
