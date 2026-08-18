import { describe, it, expect, vi, beforeEach } from "vitest";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { systemPromptFor, parseDraftJson, draftTechMessage } = await import("@/lib/tech-radar/draft");

function input(over: Partial<Parameters<typeof draftTechMessage>[0]> = {}) {
  return {
    contactFullName: "Dana Levi",
    hebrewFirstName: "דנה",
    contactTitle: "VP Payments",
    companyName: "בנק הפועלים",
    relationship: "PROSPECT" as const,
    technology: "Fraud Shield",
    vendor: "Acme",
    fitRationale: "מתחבר לביט ולתשלומים בין-אישיים שאתם מפעילים",
    ...over,
  };
}
function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}

beforeEach(() => chat.mockReset());

describe("systemPromptFor", () => {
  it("returns two different prompts for the two relationships", () => {
    expect(systemPromptFor("CUSTOMER")).not.toBe(systemPromptFor("PROSPECT"));
  });

  it("forbids emojis in both variants", () => {
    for (const r of ["CUSTOMER", "PROSPECT"] as const) {
      expect(systemPromptFor(r)).toContain("ZERO emojis");
    }
  });

  it("forbids links in both variants — the UI shows the source separately", () => {
    for (const r of ["CUSTOMER", "PROSPECT"] as const) {
      expect(systemPromptFor(r)).toMatch(/Do NOT include any URL/);
    }
  });

  it("forbids pitching and meeting requests for a prospect", () => {
    const p = systemPromptFor("PROSPECT");
    expect(p).toMatch(/Do NOT pitch/);
    expect(p).toMatch(/do NOT ask for a meeting/);
  });

  it("lets a customer message reference the shared work", () => {
    const c = systemPromptFor("CUSTOMER");
    expect(c).toContain("שווה שנסתכל");
    expect(c).toMatch(/do NOT pitch/i);
  });

  it("caps both variants at 1-2 sentences", () => {
    for (const r of ["CUSTOMER", "PROSPECT"] as const) {
      expect(systemPromptFor(r)).toContain("1-2 short sentences");
    }
  });
});

describe("parseDraftJson", () => {
  it("parses plain and fenced responses", () => {
    expect(parseDraftJson('{"draftMessage":"היי דנה"}')).toBe("היי דנה");
    expect(parseDraftJson('```json\n{"draftMessage":"היי דנה"}\n```')).toBe("היי דנה");
  });
  it("returns null for an empty or missing message", () => {
    expect(parseDraftJson('{"draftMessage":"  "}')).toBeNull();
    expect(parseDraftJson("{}")).toBeNull();
    expect(parseDraftJson("sorry")).toBeNull();
  });
});

describe("draftTechMessage", () => {
  it("returns the drafted message", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"היי דנה, נתקלתי במשהו חדש בזיהוי הונאות."}'));
    await expect(draftTechMessage(input())).resolves.toBe("היי דנה, נתקלתי במשהו חדש בזיהוי הונאות.");
  });

  // The rationale is what makes the message specific rather than a news digest.
  it("feeds the fitRationale into the prompt", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input());
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain("מתחבר לביט ולתשלומים בין-אישיים שאתם מפעילים");
    expect(body.messages[1].content).toContain("דנה");
  });

  it("selects the system prompt by relationship", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input({ relationship: "CUSTOMER" }));
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[0].content).toBe(systemPromptFor("CUSTOMER"));
  });

  it("is tagged for cost attribution", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input());
    expect(chat.mock.calls[0][0]).toBe("tech-radar-draft");
  });

  it("throws on a failed call and on unparseable output", async () => {
    chat.mockResolvedValue({ ok: false, status: 500, data: {} });
    await expect(draftTechMessage(input())).rejects.toThrow(/HTTP 500/);
    chat.mockResolvedValue(ok("nope"));
    await expect(draftTechMessage(input())).rejects.toThrow(/unparseable/);
  });
});
