type Input = {
  timezone: string;          // IANA, e.g. "Asia/Jerusalem"
  workingHoursStart: number; // 0-23
  workingHoursEnd: number;   // 0-23
  weekdaysOnly: boolean;
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
  const candidate = addRandomMinutes(now, MIN_GAP_MIN, MAX_GAP_MIN);

  if (input.sentTodayCount >= input.dailyCap) {
    return nextWorkdayStart(now, input);
  }
  if (input.sentLastHourCount >= input.hourlyCap) {
    return roundUpToNextHour(candidate);
  }
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

function clampToWorkingHours(d: Date, input: Input): Date {
  const local = toZonedParts(d, input.timezone);
  const inHours = local.hour >= input.workingHoursStart && local.hour < input.workingHoursEnd;
  const isWeekday = local.weekday >= 1 && local.weekday <= 5;
  if (inHours && (!input.weekdaysOnly || isWeekday)) return d;
  return nextWorkdayStart(d, input);
}

function nextWorkdayStart(from: Date, input: Input): Date {
  let cursor = new Date(from);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (true) {
    const parts = toZonedParts(cursor, input.timezone);
    const isWeekday = parts.weekday >= 1 && parts.weekday <= 5;
    if (!input.weekdaysOnly || isWeekday) {
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
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);
}
