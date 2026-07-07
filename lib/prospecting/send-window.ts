import { z } from "zod";

/** Hebrew day letters, index = weekday (0=Sun … 6=Sat). */
export const DAY_LETTERS_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;

export const DEFAULT_SEND_DAYS = [0, 1, 2, 3, 4]; // Sun-Thu
export const DEFAULT_SEND_HOURS_START = 9;
export const DEFAULT_SEND_HOURS_END = 18;

/** De-dupe + ascending sort for a client-supplied day list. */
export function normalizeSendDays(days: number[]): number[] {
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

/** Zod raw shape shared by the create (POST) and edit (PATCH) run APIs. All optional. */
export const sendWindowFields = {
  sendDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  sendHoursStart: z.number().int().min(0).max(23).optional(),
  sendHoursEnd: z.number().int().min(1).max(24).optional(),
};

/**
 * Cross-field rule: hour bounds only make sense as a pair, and end must be
 * after start. A lone bound can't be validated against the stored value here.
 */
export function sendWindowRefine(data: { sendHoursStart?: number; sendHoursEnd?: number }): boolean {
  const hasStart = data.sendHoursStart !== undefined;
  const hasEnd = data.sendHoursEnd !== undefined;
  if (hasStart !== hasEnd) return false;
  if (hasStart && hasEnd) return data.sendHoursEnd! > data.sendHoursStart!;
  return true;
}

/**
 * Resolve a run's send window for the scheduler. Empty sendDays = legacy rows
 * that predate the feature → the historical default (Sun-Thu in Israel, Mon-Fri elsewhere).
 */
export function resolveSendWindow(
  run: { sendDays: number[]; sendHoursStart: number; sendHoursEnd: number },
  timezone: string
): { workingWeekdays: number[]; workingHoursStart: number; workingHoursEnd: number } {
  const workingWeekdays =
    run.sendDays.length > 0 ? run.sendDays : timezone === "Asia/Jerusalem" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
  return { workingWeekdays, workingHoursStart: run.sendHoursStart, workingHoursEnd: run.sendHoursEnd };
}

const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

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
export function formatSendWindowHe(days: number[], hoursStart: number, hoursEnd: number): string {
  const daysPart = formatSendDaysHe(days);
  const prefix = daysPart === "כל השבוע" ? `יישלח ${daysPart}` : `יישלח בימים ${daysPart}`;
  return `${prefix}, בין ${fmtHour(hoursStart)} ל־${fmtHour(hoursEnd)} (שעון ישראל)`;
}
