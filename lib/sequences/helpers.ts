import { fromZonedTime } from "date-fns-tz";
import { spacedSlotMs, assignWindowIndices, SAFE_GAP_MIN } from "@/lib/sequences/spacing";

const TIMEZONE = "Asia/Jerusalem";

export function computeScheduledAt(
  enrolledAt: Date,
  dayOffset: number,
  sendHour: number,
  sendMinute: number
): Date {
  const base = new Date(enrolledAt);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, "0");
  const day = String(base.getUTCDate()).padStart(2, "0");
  const h = String(sendHour).padStart(2, "0");
  const m = String(sendMinute).padStart(2, "0");
  return fromZonedTime(`${year}-${month}-${day}T${h}:${m}:00`, TIMEZONE);
}

export type ParsedStep = {
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP" | "LINKEDIN";
  templateId: string;
  subject: string | null;
  sendHour: number;
  sendMinute: number;
  sendHourEnd: number | null;
};

export function parseSteps(input: unknown): ParsedStep[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const steps: ParsedStep[] = [];
  const seenNumbers = new Set<number>();
  let prevOffset: number | null = null;
  for (const raw of input as Record<string, unknown>[]) {
    if (typeof raw.stepNumber !== "number" || typeof raw.dayOffset !== "number") return null;
    if (!Number.isInteger(raw.dayOffset) || raw.dayOffset < 0) return null;
    if (typeof raw.templateId !== "string" || !raw.templateId) return null;
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP" && raw.channel !== "LINKEDIN") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (prevOffset !== null && raw.dayOffset < prevOffset) return null;
    const rawHour = raw.sendHour ?? 9;
    const rawMinute = raw.sendMinute ?? 0;
    const rawHourEnd = raw.sendHourEnd ?? null;
    if (!Number.isInteger(rawHour) || (rawHour as number) < 0 || (rawHour as number) > 23) return null;
    if (!Number.isInteger(rawMinute) || (rawMinute as number) < 0 || (rawMinute as number) > 59) return null;
    if (rawHourEnd !== null) {
      if (!Number.isInteger(rawHourEnd) || (rawHourEnd as number) < 0 || (rawHourEnd as number) > 23) return null;
      if ((rawHourEnd as number) <= (rawHour as number)) return null;
    }
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel as "EMAIL" | "WHATSAPP" | "LINKEDIN",
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
      sendHour: rawHour as number,
      sendMinute: rawMinute as number,
      sendHourEnd: rawHourEnd as number | null,
    });
  }
  return steps;
}

export { SAFE_GAP_MIN };

export function computeSpacedScheduledAt(
  enrolledAt: Date,
  step: { dayOffset: number; sendHour: number; sendMinute: number; sendHourEnd: number | null },
  indexInWindow: number,
  gapMin: number = SAFE_GAP_MIN
): Date {
  const windowStart = computeScheduledAt(enrolledAt, step.dayOffset, step.sendHour, step.sendMinute).getTime();
  const windowEnd =
    step.sendHourEnd === null
      ? null
      : computeScheduledAt(enrolledAt, step.dayOffset, step.sendHourEnd, 0).getTime();
  return new Date(spacedSlotMs(windowStart, windowEnd, indexInWindow, gapMin));
}

export type EnrollmentExecutionRow = { stepId: string; status: "PENDING"; scheduledAt: Date };

/** Build PENDING execution rows for every step of one enrollment, spaced within each shared window. */
export function buildEnrollmentExecutions(
  enrolledAt: Date,
  orderedSteps: Array<{
    id: string;
    dayOffset: number;
    sendHour: number;
    sendMinute: number;
    sendHourEnd: number | null;
  }>
): EnrollmentExecutionRow[] {
  return assignWindowIndices(orderedSteps).map((step) => ({
    stepId: step.id,
    status: "PENDING" as const,
    scheduledAt: computeSpacedScheduledAt(enrolledAt, step, step.indexInWindow),
  }));
}
