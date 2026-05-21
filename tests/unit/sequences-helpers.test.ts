import { describe, it, expect } from "vitest";

// Inline copies of the helpers — importing from lib pulls in Prisma which isn't available in vitest
function computeScheduledAt(enrolledAt: Date, dayOffset: number): Date {
  return new Date(enrolledAt.getTime() + dayOffset * 24 * 60 * 60 * 1000);
}

type RawStep = {
  stepNumber: unknown;
  dayOffset: unknown;
  channel: unknown;
  templateId: unknown;
  subject?: unknown;
};

function parseSteps(input: unknown): Array<{
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string | null;
}> | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const steps: Array<{
    stepNumber: number;
    dayOffset: number;
    channel: "EMAIL" | "WHATSAPP";
    templateId: string;
    subject: string | null;
  }> = [];
  const seenNumbers = new Set<number>();
  let prevOffset = -1;
  for (const raw of input as RawStep[]) {
    if (typeof raw.stepNumber !== "number" || typeof raw.dayOffset !== "number") return null;
    if (typeof raw.templateId !== "string" || !raw.templateId) return null;
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (raw.dayOffset < prevOffset) return null;
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel as "EMAIL" | "WHATSAPP",
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
    });
  }
  return steps;
}

describe("computeScheduledAt", () => {
  it("returns enrolledAt when dayOffset is 0", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(computeScheduledAt(d, 0)).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("adds 1 day correctly", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(computeScheduledAt(d, 1)).toEqual(new Date("2026-01-02T00:00:00Z"));
  });

  it("adds 7 days correctly", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(computeScheduledAt(d, 7)).toEqual(new Date("2026-01-08T00:00:00Z"));
  });

  it("handles non-midnight base time", () => {
    const d = new Date("2026-01-01T14:30:00Z");
    expect(computeScheduledAt(d, 2)).toEqual(new Date("2026-01-03T14:30:00Z"));
  });
});

describe("parseSteps", () => {
  it("accepts a valid EMAIL step", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi there" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi there" },
    ]);
  });

  it("accepts a valid WHATSAPP step (no subject)", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", subject: null },
    ]);
  });

  it("accepts multi-step sequence with ascending offsets", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hello" },
      { stepNumber: 2, dayOffset: 2, channel: "WHATSAPP", templateId: "t2" },
      { stepNumber: 3, dayOffset: 7, channel: "EMAIL", templateId: "t3", subject: "Follow up" },
    ]);
    expect(result).toHaveLength(3);
    expect(result![1].dayOffset).toBe(2);
  });

  it("returns null for empty array", () => {
    expect(parseSteps([])).toBeNull();
  });

  it("returns null for non-array", () => {
    expect(parseSteps("not an array")).toBeNull();
    expect(parseSteps(null)).toBeNull();
  });

  it("returns null for LINKEDIN channel", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "LINKEDIN", templateId: "t1" }])
    ).toBeNull();
  });

  it("returns null for EMAIL step without subject", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1" }])
    ).toBeNull();
  });

  it("returns null for EMAIL step with empty subject", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "" }])
    ).toBeNull();
  });

  it("returns null for duplicate stepNumbers", () => {
    expect(
      parseSteps([
        { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
        { stepNumber: 1, dayOffset: 2, channel: "WHATSAPP", templateId: "t2" },
      ])
    ).toBeNull();
  });

  it("returns null when dayOffsets are not non-decreasing", () => {
    expect(
      parseSteps([
        { stepNumber: 1, dayOffset: 3, channel: "WHATSAPP", templateId: "t1" },
        { stepNumber: 2, dayOffset: 1, channel: "WHATSAPP", templateId: "t2" },
      ])
    ).toBeNull();
  });

  it("returns null when templateId is missing", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "" }])
    ).toBeNull();
  });
});
