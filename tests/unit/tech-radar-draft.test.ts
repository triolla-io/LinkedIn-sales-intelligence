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
    sourceUrl: "https://example.com/a?x=1&y=2",
    ...over,
  };
}
function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}

beforeEach(() => chat.mockReset());

/**
 * v2 register: forwarding an article to someone you know. v1 closed every message with
 * "אולי תוכלו לשלב את זה ב___ אצלכם" and banned links — that made each message a soft
 * pitch from a system, which is exactly what this feature must not sound like.
 */
describe("DRAFT_SYSTEM", () => {
  it("lays out the shape: came across it, why them, then the link", () => {
    expect(DRAFT_SYSTEM).toMatch(/נתקלתי|ראיתי/);
    expect(DRAFT_SYSTEM).toMatch(/thought of you/i);
    expect(DRAFT_SYSTEM).toMatch(/last line/i);
  });

  /**
   * The two v1 clauses that made it a pitch. Pinned by their literal Hebrew so a
   * future prompt edit cannot quietly reintroduce either one.
   */
  it("bans the v1 adoption suggestion outright", () => {
    expect(DRAFT_SYSTEM).not.toMatch(/אולי תוכלו לשלב את זה ב___/);
    expect(DRAFT_SYSTEM).toMatch(/NO SUGGESTION/);
    expect(DRAFT_SYSTEM).toMatch(/אולי תוכלו לשלב/);   // named, as forbidden wording
    expect(DRAFT_SYSTEM).toMatch(/כדאי לבדוק/);
  });

  it("bans every kind of ask", () => {
    expect(DRAFT_SYSTEM).toMatch(/NO ASK/);
    expect(DRAFT_SYSTEM).toMatch(/מה דעתך/);
    expect(DRAFT_SYSTEM).toMatch(/no meeting, no call/i);
  });

  it("requires the link, verbatim, and forbids inventing one", () => {
    expect(DRAFT_SYSTEM).toMatch(/EXACTLY as given/);
    expect(DRAFT_SYSTEM).toMatch(/Never invent/i);
    expect(DRAFT_SYSTEM).not.toMatch(/Do NOT include any URL$/m);
  });

  /**
   * First live run of the v1 shape: the model pasted the whole relevance note in place
   * of naming the place. The anchor has to stay a short noun phrase in v2 too.
   */
  it("caps the why-them anchor to a short noun phrase", () => {
    expect(DRAFT_SYSTEM).toMatch(/noun phrase/i);
    expect(DRAFT_SYSTEM).toMatch(/2-6 words/);
  });

  it("forbids copying the relevance note into the message", () => {
    expect(DRAFT_SYSTEM).toMatch(/NEVER copy/);
  });

  it("keeps it to one or two sentences", () => {
    expect(DRAFT_SYSTEM).toMatch(/1-2 short sentences MAXIMUM/);
  });

  it("still forbids emojis, marketing register and flattery", () => {
    expect(DRAFT_SYSTEM).toContain("ZERO emojis");
    expect(DRAFT_SYSTEM).toMatch(/marketing/i);
    expect(DRAFT_SYSTEM).toMatch(/flattery/i);
  });

  it("never sells anything on our behalf", () => {
    expect(DRAFT_SYSTEM).toMatch(/not a pitch/i);
    expect(DRAFT_SYSTEM).toMatch(/our services/);
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

  // The rationale is background for the "why them" anchor.
  it("feeds the fitRationale into the prompt", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input());
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain("מתחבר לביט ולתשלומים בין-אישיים שאתם מפעילים");
    expect(body.messages[1].content).toContain("דנה");
  });

  it("passes the link through for verbatim reproduction", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input());
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain("https://example.com/a?x=1&y=2");
    expect(body.messages[1].content).toMatch(/verbatim/i);
  });

  // A snippet-only item has no readable source. Saying nothing about the link invites
  // the model to invent one, so the absence is stated explicitly.
  it("tells the model there is no link when the item has none", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"x"}'));
    await draftTechMessage(input({ sourceUrl: null }));
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toMatch(/none available/);
    expect(body.messages[1].content).not.toContain("https://");
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

const { firstSourceUrl } = await import("@/lib/tech-radar/create-drafts");

/**
 * `TechItem.sources` is untyped JSON written by an LLM-fed pipeline, so every branch
 * here has actually occurred: no sources at all, a thin item, a relative path.
 */
describe("firstSourceUrl", () => {
  it("takes the first http(s) url", () => {
    expect(firstSourceUrl([{ url: "https://a.com/1" }, { url: "https://b.com/2" }])).toBe("https://a.com/1");
    expect(firstSourceUrl([{ url: "  http://a.com/1  " }])).toBe("http://a.com/1");
  });

  it("skips entries that are not usable links rather than returning them", () => {
    expect(firstSourceUrl([{ url: "/relative/path" }, { url: "https://b.com/2" }])).toBe("https://b.com/2");
    expect(firstSourceUrl([{ title: "no url" }, { url: 42 }, { url: "https://c.com" }])).toBe("https://c.com");
  });

  it("returns null when there is nothing to forward", () => {
    expect(firstSourceUrl([])).toBeNull();
    expect(firstSourceUrl(null)).toBeNull();
    expect(firstSourceUrl("https://not-an-array.com")).toBeNull();
    expect(firstSourceUrl([{ url: "javascript:alert(1)" }])).toBeNull();
  });
});
