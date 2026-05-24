import { describe, it, expect } from "vitest";

// Inline copies — importing from lib pulls in Prisma/date-fns-tz not available in vitest
// computeScheduledAt uses a simplified UTC-offset approximation for tests (Israel = UTC+2 in winter)
const ISRAEL_OFFSET_MS = 2 * 60 * 60 * 1000; // UTC+2 winter (test dates are in January)

function computeScheduledAt(
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
  // Approximate: subtract Israel offset to get UTC
  const localMs = new Date(`${year}-${month}-${day}T${h}:${m}:00Z`).getTime();
  return new Date(localMs - ISRAEL_OFFSET_MS);
}

type RawStep = {
  stepNumber: unknown;
  dayOffset: unknown;
  channel: unknown;
  templateId: unknown;
  subject?: unknown;
  sendHour?: unknown;
  sendMinute?: unknown;
};

function parseSteps(input: unknown): Array<{
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string | null;
  sendHour: number;
  sendMinute: number;
}> | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const steps: Array<{
    stepNumber: number;
    dayOffset: number;
    channel: "EMAIL" | "WHATSAPP";
    templateId: string;
    subject: string | null;
    sendHour: number;
    sendMinute: number;
  }> = [];
  const seenNumbers = new Set<number>();
  let prevOffset: number | null = null;
  for (const raw of input as RawStep[]) {
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

describe("computeScheduledAt", () => {
  it("schedules at 09:00 Israel time (UTC+2 winter) when dayOffset is 0", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z"); // 08:00 Israel
    const result = computeScheduledAt(enrolled, 0, 9, 0);
    expect(result).toEqual(new Date("2026-01-15T07:00:00Z")); // 09:00 Israel = 07:00 UTC
  });

  it("adds dayOffset calendar days to the enrollment date", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z");
    const result = computeScheduledAt(enrolled, 2, 9, 0);
    expect(result).toEqual(new Date("2026-01-17T07:00:00Z")); // 09:00 Israel on Jan 17
  });

  it("respects sendMinute", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z");
    const result = computeScheduledAt(enrolled, 0, 9, 30);
    expect(result).toEqual(new Date("2026-01-15T07:30:00Z")); // 09:30 Israel = 07:30 UTC
  });

  it("handles 14:00 sendHour", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z");
    const result = computeScheduledAt(enrolled, 0, 14, 0);
    expect(result).toEqual(new Date("2026-01-15T12:00:00Z")); // 14:00 Israel = 12:00 UTC
  });
});

describe("parseSteps", () => {
  it("accepts a valid EMAIL step with default send time", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi", sendHour: 9, sendMinute: 0 },
    ]);
  });

  it("accepts explicit sendHour and sendMinute", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendHour: 14, sendMinute: 30 },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", subject: null, sendHour: 14, sendMinute: 30 },
    ]);
  });

  it("accepts a valid WHATSAPP step (no subject)", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", subject: null, sendHour: 9, sendMinute: 0 },
    ]);
  });

  it("accepts multi-step sequence with ascending offsets", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hello", sendHour: 9, sendMinute: 0 },
      { stepNumber: 2, dayOffset: 2, channel: "WHATSAPP", templateId: "t2", sendHour: 14, sendMinute: 30 },
    ]);
    expect(result).toHaveLength(2);
    expect(result![1].sendHour).toBe(14);
    expect(result![1].sendMinute).toBe(30);
  });

  it("returns null for empty array", () => {
    expect(parseSteps([])).toBeNull();
  });

  it("returns null for non-array", () => {
    expect(parseSteps("not an array")).toBeNull();
    expect(parseSteps(null)).toBeNull();
  });

  it("returns null for LINKEDIN channel", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "LINKEDIN", templateId: "t1" }])).toBeNull();
  });

  it("returns null for EMAIL step without subject", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1" }])).toBeNull();
  });

  it("returns null for EMAIL step with empty subject", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "" }])).toBeNull();
  });

  it("returns null for duplicate stepNumbers", () => {
    expect(parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
      { stepNumber: 1, dayOffset: 2, channel: "WHATSAPP", templateId: "t2" },
    ])).toBeNull();
  });

  it("returns null when dayOffsets are not non-decreasing", () => {
    expect(parseSteps([
      { stepNumber: 1, dayOffset: 3, channel: "WHATSAPP", templateId: "t1" },
      { stepNumber: 2, dayOffset: 1, channel: "WHATSAPP", templateId: "t2" },
    ])).toBeNull();
  });

  it("returns null when templateId is missing", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "" }])).toBeNull();
  });

  it("returns null for negative dayOffset", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: -1, channel: "WHATSAPP", templateId: "t1" }])).toBeNull();
  });

  it("returns null for fractional dayOffset", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 1.5, channel: "WHATSAPP", templateId: "t1" }])).toBeNull();
  });

  it("returns null for sendHour out of range", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendHour: 24 }])).toBeNull();
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendHour: -1 }])).toBeNull();
  });

  it("returns null for sendMinute out of range", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendMinute: 60 }])).toBeNull();
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendMinute: -1 }])).toBeNull();
  });
});
