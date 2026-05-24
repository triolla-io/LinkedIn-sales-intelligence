import { fromZonedTime } from "date-fns-tz";

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
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string | null;
  sendHour: number;
  sendMinute: number;
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
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (prevOffset !== null && raw.dayOffset < prevOffset) return null;
    const rawHour = raw.sendHour ?? 9;
    const rawMinute = raw.sendMinute ?? 0;
    if (!Number.isInteger(rawHour) || (rawHour as number) < 0 || (rawHour as number) > 23) return null;
    if (!Number.isInteger(rawMinute) || (rawMinute as number) < 0 || (rawMinute as number) > 59) return null;
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel as "EMAIL" | "WHATSAPP",
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
      sendHour: rawHour as number,
      sendMinute: rawMinute as number,
    });
  }
  return steps;
}
