import { describe, it, expect, vi, beforeEach } from "vitest";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { DRAFT_SYSTEM, parseDraftJson, draftTechMessage } = await import("@/lib/tech-radar/draft");

function input(over: Partial<Parameters<typeof draftTechMessage>[0]> = {}) {
  return {
    contactFullName: "Dana Levi",
    hebrewFirstName: "דנה",
    contactTitle: "VP Payments",
    companyName: "בנק הפועלים",
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

/**
 * One phrasing for every company. The earlier customer/prospect split was dropped by
 * product decision: a single advisory register covers both, and the relationship flag
 * now only informs the human reading the draft.
 */
describe("DRAFT_SYSTEM", () => {
  it("lays out the three-part shape: saw it, what it does, where it could fit", () => {
    expect(DRAFT_SYSTEM).toMatch(/ראיתי/);
    expect(DRAFT_SYSTEM).toMatch(/אולי תוכלו לשלב את זה/);
  });

  it("requires the closing suggestion to name a concrete place in their business", () => {
    expect(DRAFT_SYSTEM).toMatch(/specific|concrete/i);
  });

  /**
   * First live run of this shape: the model pasted the whole relevance note into the
   * blank — "...בפלטפורמת CDP המאוחדת שלכם כדי לתזמן הצעות מותאמות ב-50+ מועדוני
   * הלויאליות של IsraCard ולהגביר חוצ-מכירות בקרטיס, אשראי וסחר" — instead of naming
   * the place. The blank has to be a short noun phrase.
   */
  it("caps the closing blank to a short noun phrase", () => {
    expect(DRAFT_SYSTEM).toMatch(/noun phrase/i);
    expect(DRAFT_SYSTEM).toMatch(/2-6 words|two to six words/i);
  });

  it("forbids copying the relevance note into the message", () => {
    expect(DRAFT_SYSTEM).toMatch(/do not copy|never copy/i);
  });

  it("requires the closing to keep its suggestion wording", () => {
    expect(DRAFT_SYSTEM).toMatch(/must .*אולי תוכלו לשלב|אולי תוכלו לשלב.*required/i);
  });

  it("keeps the explanation very short", () => {
    expect(DRAFT_SYSTEM).toMatch(/one short clause|very short/i);
  });

  it("still forbids emojis and links", () => {
    expect(DRAFT_SYSTEM).toContain("ZERO emojis");
    expect(DRAFT_SYSTEM).toMatch(/Do NOT include any URL/);
  });

  it("still bans marketing register and flattery", () => {
    expect(DRAFT_SYSTEM).toMatch(/marketing/i);
    expect(DRAFT_SYSTEM).toMatch(/flattery/i);
  });

  it("does not sell anything on our behalf", () => {
    // The suggestion is about the technology, never about hiring us.
    expect(DRAFT_SYSTEM).toMatch(/do not offer|not a pitch|do NOT pitch/i);
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
    chat.mockResolvedValue(ok('{"draftMessage":"היי דנה, ראיתי משהו חדש בזיהוי הונאות."}'));
    await expect(draftTechMessage(input())).resolves.toBe("היי דנה, ראיתי משהו חדש בזיהוי הונאות.");
  });

  it("uses the one shared prompt for every company", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input());
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[0].content).toBe(DRAFT_SYSTEM);
  });

  // The rationale is what tells the model WHERE the technology could fit.
  it("feeds the fitRationale into the prompt", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input());
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain("מתחבר לביט ולתשלומים בין-אישיים שאתם מפעילים");
    expect(body.messages[1].content).toContain("דנה");
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
