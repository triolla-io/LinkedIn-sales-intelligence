import { z } from "zod";

/** Hebrew day letters, index = weekday (0=Sun … 6=Sat). */
export const DAY_LETTERS_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;

export const DEFAULT_SEND_DAYS = [0, 1, 2, 3, 4]; // Sun-Thu
export const DEFAULT_SEND_HOURS_START = 9;
export const DEFAULT_SEND_HOURS_END = 18;
export const DEFAULT_SEND_MINUTES_START = 0;
export const DEFAULT_SEND_MINUTES_END = 0;

/** De-dupe + ascending sort for a client-supplied day list. */
export function normalizeSendDays(days: number[]): number[] {
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

/** Zod raw shape shared by the create (POST) and edit (PATCH) run APIs. All optional. */
export const sendWindowFields = {
  sendDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  sendHoursStart: z.number().int().min(0).max(23).optional(),
  sendHoursEnd: z.number().int().min(1).max(24).optional(),
  // Half-hour granularity: minute offset within the start/end hour (21:30 = hoursEnd 21 + minutesEnd 30).
  sendMinutesStart: z.union([z.literal(0), z.literal(30)]).optional(),
  sendMinutesEnd: z.union([z.literal(0), z.literal(30)]).optional(),
};

/**
 * Cross-field rule: hour bounds only make sense as a pair (minutes only alongside
 * their hours), and end must be after start. A lone bound can't be validated
 * against the stored value here.
 */
export function sendWindowRefine(data: {
  sendHoursStart?: number;
  sendHoursEnd?: number;
  sendMinutesStart?: number;
  sendMinutesEnd?: number;
}): boolean {
  const hasStart = data.sendHoursStart !== undefined;
  const hasEnd = data.sendHoursEnd !== undefined;
  if (hasStart !== hasEnd) return false;
  if (!hasStart) return data.sendMinutesStart === undefined && data.sendMinutesEnd === undefined;
  const start = data.sendHoursStart! * 60 + (data.sendMinutesStart ?? 0);
  const end = data.sendHoursEnd! * 60 + (data.sendMinutesEnd ?? 0);
  return end > start && end <= 24 * 60;
}

/**
 * Resolve a run's send window for the scheduler. Empty sendDays = legacy rows
 * that predate the feature → the historical default (Sun-Thu in Israel, Mon-Fri elsewhere).
 */
export function resolveSendWindow(
  run: { sendDays: number[]; sendHoursStart: number; sendHoursEnd: number; sendMinutesStart?: number; sendMinutesEnd?: number },
  timezone: string
): {
  workingWeekdays: number[];
  workingHoursStart: number;
  workingHoursEnd: number;
  workingMinutesStart: number;
  workingMinutesEnd: number;
} {
  const workingWeekdays =
    run.sendDays.length > 0 ? run.sendDays : timezone === "Asia/Jerusalem" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
  return {
    workingWeekdays,
    workingHoursStart: run.sendHoursStart,
    workingHoursEnd: run.sendHoursEnd,
    workingMinutesStart: run.sendMinutesStart ?? 0,
    workingMinutesEnd: run.sendMinutesEnd ?? 0,
  };
}

const fmtTime = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** "א׳–ה׳" / "א׳, ג׳, ה׳" / "כל השבוע" — consecutive days collapse into a range. */
export function formatSendDaysHe(days: number[]): string {
  const sorted = normalizeSendDays(days);
  if (sorted.length === 7) return "כל השבוע";
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const a = DAY_LETTERS_HE[sorted[i]];
    const b = DAY_LETTERS_HE[sorted[j]];
    parts.push(j === i ? a : j === i + 1 ? `${a}, ${b}` : `${a}–${b}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** The live summary sentence shown under the picker and on the run-detail card. */
export function formatSendWindowHe(
  days: number[],
  hoursStart: number,
  hoursEnd: number,
  minutesStart = 0,
  minutesEnd = 0
): string {
  const daysPart = formatSendDaysHe(days);
  const prefix = daysPart === "כל השבוע" ? `יישלח ${daysPart}` : `יישלח בימים ${daysPart}`;
  return `${prefix}, בין ${fmtTime(hoursStart, minutesStart)} ל־${fmtTime(hoursEnd, minutesEnd)} (שעון ישראל)`;
}
