import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDraftVariants } from "@/lib/company-signals/draft";

const VALID = {
  linkedin: "היי דנה, נתקלתי בידיעה על הגיוס. סחטיין, בהצלחה בהמשך.",
  whatsapp: "היי דנה, ראיתי את הידיעה על הגיוס. סחטיין.",
  emailSubject: "סחטיין על הגיוס",
  emailBody: "היי דנה,\nנתקלתי בידיעה על הגיוס. סחטיין, בהצלחה בהמשך.\nאריאל",
};

describe("parseDraftVariants", () => {
  it("parses all four fields, strips fences", () => {
    const out = parseDraftVariants("```json\n" + JSON.stringify(VALID) + "\n```");
    expect(out).toEqual(VALID);
  });
  it("returns null when any field is missing or empty", () => {
    for (const key of ["linkedin", "whatsapp", "emailSubject", "emailBody"] as const) {
      expect(parseDraftVariants(JSON.stringify({ ...VALID, [key]: "" }))).toBe(null);
      const { [key]: _omitted, ...rest } = VALID;
      expect(parseDraftVariants(JSON.stringify(rest))).toBe(null);
    }
  });
  it("returns null for garbage", () => {
    expect(parseDraftVariants("garbage")).toBe(null);
  });
});

describe("draftCongrats", () => {
  const realFetch = global.fetch;
  beforeEach(() => { delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => { global.fetch = realFetch; });

  const input = {
    contactFullName: "Dana Cohen", hebrewFirstName: "דנה", contactTitle: "CEO",
    companyName: "Acme", signalType: "FUNDING", signalTitle: "Raised $10M",
    signalSummary: "Series A", eventDate: "2026-07-15", today: "2026-07-29",
  };

  it("throws when OPENROUTER_API_KEY missing", async () => {
    const { draftCongrats } = await import("@/lib/company-signals/draft");
    await expect(draftCongrats(input)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it("returns all variants on success and sends the dates in the prompt", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(VALID) } }],
    }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { draftCongrats } = await import("@/lib/company-signals/draft");
    expect(await draftCongrats(input)).toEqual(VALID);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const sent = JSON.parse(init.body);
    const userMsg = sent.messages[1].content as string;
    expect(userMsg).toContain("Event date: 2026-07-15");
    expect(userMsg).toContain("Today: 2026-07-29");
  });

  it("throws on unparseable output", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "not json" } }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { draftCongrats } = await import("@/lib/company-signals/draft");
    await expect(draftCongrats(input)).rejects.toThrow(/unparseable/);
  });
});
