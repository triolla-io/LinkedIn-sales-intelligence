import { describe, it, expect, vi, beforeEach } from "vitest";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { DRAFT_SYSTEM, parseDraftJson, draftTechMessage, salutationName, unverifiedQuantities, enforceDraftRules } =
  await import("@/lib/tech-radar/draft");

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
    itemText: "Fraud Shield זיהוי הונאות בזמן אמת",
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
   * 2026-08-24 review, Uri/MLB draft: the whyHim said "contract renewals against
   * leagues — pricing/exclusivity/latency change" and the message said "בגלל נתוני
   * אירועים בזמן אמת" — the specific stake flattened into its category. The anchor is
   * no longer a bare noun phrase: the LAST sentence must carry the reason itself,
   * rephrased for a person. The acceptance test is deletion: remove the item's subject
   * and it must still be clear why THIS person received the message.
   */
  it("makes the last sentence carry the specific whyHim reason", () => {
    expect(DRAFT_SYSTEM).toMatch(/LAST sentence/);
    expect(DRAFT_SYSTEM).toMatch(/delete the item's subject/i);
    expect(DRAFT_SYSTEM).toMatch(/category/);
  });

  it("forbids copying the relevance note into the message", () => {
    expect(DRAFT_SYSTEM).toMatch(/NEVER copy/);
  });

  /**
   * 2026-08-26, Gil Tamir: "נתקלתי במחקר על משהו שכנראה קשור ישירות לבחירות שלך" — the
   * opener named nothing. Paired with the opener_mush guard in draft-guard.ts.
   */
  it("requires the opener to name the thing it saw, not just announce it exists", () => {
    expect(DRAFT_SYSTEM).toMatch(/opener NAMES the thing it saw/);
    expect(DRAFT_SYSTEM).toMatch(/נתקלתי במשהו ש/);
  });

  it("allows a short paragraph — 3-6 sentences, capped at 600 chars", () => {
    expect(DRAFT_SYSTEM).toMatch(/3-6 short sentences TOTAL/);
    expect(DRAFT_SYSTEM).toMatch(/600 characters/);
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

describe("Yuval's voice", () => {
  it("carries the three real samples verbatim", () => {
    expect(DRAFT_SYSTEM).toContain("וואי איזה הזדמנות מטורפת! חייבים להשיג אותם");
    expect(DRAFT_SYSTEM).toContain("היי, ראית את זה?");
    expect(DRAFT_SYSTEM).toContain("הזדמנות למצב את הבנק כסופר חדשני!");
  });
  it("allows a rhetorical question only as the opener", () => {
    expect(DRAFT_SYSTEM).toMatch(/question mark is allowed HERE and nowhere else/i);
  });
  it("bans the old polite-distant register", () => {
    expect(DRAFT_SYSTEM).toMatch(/Never polite-distant/i);
  });
  it("requires a content paragraph distilled from the item text", () => {
    expect(DRAFT_SYSTEM).toMatch(/2-3 short sentences distilled from the item's own text/i);
  });
  // The excitement is licensed about what the item means for the recipient, never about
  // the item's own importance — "this changes the whole industry" is an invented claim,
  // not the sender's enthusiasm, unless the item itself says so.
  it("bans inventing significance the item doesn't claim for itself", () => {
    expect(DRAFT_SYSTEM).toMatch(/never a claim about how important the item is/i);
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
  it("returns the drafted message, with the link guaranteed present", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"היי דנה, ראיתי משהו חדש בזיהוי הונאות."}'));
    // The model dropped the link; the guard appends the canonical one.
    await expect(draftTechMessage(input())).resolves.toBe(
      "היי דנה, ראיתי משהו חדש בזיהוי הונאות.\nhttps://example.com/a?x=1&y=2"
    );
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


/**
 * Two rules the 2026-08-24 draft to Avigal Soreq broke at once: it greeted her as
 * "אביגיל" (a transliteration, not the recorded name) and asserted "בשלוש המפעלות"
 * about a company that runs four refineries — a figure no source ever supplied.
 */
describe("the recorded name is the name", () => {
  it("uses the stored Hebrew name verbatim rather than a transliteration", () => {
    const i = input({ contactFullName: "Avigal Soreq", hebrewFirstName: "אביגל" });
    const r = enforceDraftRules("היי אביגיל, נתקלתי במשהו.\nhttps://e.com/a", i);
    expect(r.ok && r.message.startsWith("היי אביגל,")).toBe(true);
  });

  it("leaves a correct greeting alone", () => {
    const i = input({ hebrewFirstName: "דנה", sourceUrl: null });
    const r = enforceDraftRules("היי דנה, ראיתי משהו.", i);
    expect(r.ok && r.message).toBe("היי דנה, ראיתי משהו.");
  });

  it("falls back to the first name on the record when no Hebrew name is stored", () => {
    expect(salutationName({ contactFullName: "Avigal Soreq", hebrewFirstName: null })).toBe("Avigal");
  });
});

describe("a figure about the recipient must come from a source", () => {
  const item = "EPA קבעה יעדי חובה לדלקים מתחדשים לשנים 2026-2027";

  it("rejects a count that appears in no source", () => {
    expect(unverifiedQuantities("היי אביגל, חשבתי עליך בגלל הנחיות התפוקה בשלוש המפעלות.", item))
      .toContain("בשלוש");
  });

  it("accepts a figure the item itself states", () => {
    expect(unverifiedQuantities("היי אביגל, נתקלתי במשהו על חובות ה-RIN ל-2026-2027.", item)).toEqual([]);
  });

  it("does not read digits out of the URL as a claim", () => {
    expect(unverifiedQuantities("היי דנה, ראיתי משהו.\nhttps://e.com/articles/9999-x", item)).toEqual([]);
  });

  it("accepts the same anchor once the count is dropped", () => {
    expect(unverifiedQuantities("היי אביגל, חשבתי עליך בגלל יעדי התפוקה שהצגתם.", item)).toEqual([]);
  });

  it("blocks the whole draft rather than sending an unverified figure", () => {
    const r = enforceDraftRules("היי אביגל, בגלל שלוש המפעלות.", input({ hebrewFirstName: "אביגל", itemText: item }));
    expect(r.ok).toBe(false);
  });
});

describe("draftTechMessage repairs an unverified figure once", () => {
  it("retries with a correction and returns the clean message", async () => {
    // "הפלטפורמות" and not the real run's "המפעלות", so this exercises the figure rule
    // alone — the wrong-term rule catches מפעלות first, and has its own test.
    chat
      .mockResolvedValueOnce(ok('{"draftMessage":"היי אביגל, בגלל שלוש הפלטפורמות."}'))
      .mockResolvedValueOnce(ok('{"draftMessage":"היי אביגל, בגלל יעדי התפוקה שהצגתם."}'));
    const i = input({ hebrewFirstName: "אביגל", itemText: "EPA קבעה יעדי חובה", sourceUrl: null });
    await expect(draftTechMessage(i)).resolves.toBe("היי אביגל, בגלל יעדי התפוקה שהצגתם.");
    expect(chat.mock.calls[1][1].messages[1].content).toMatch(/appears in no source/);
  });

  it("throws rather than returning a message that still carries the figure", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"היי אביגל, בגלל שלוש הפלטפורמות."}'));
    await expect(draftTechMessage(input({ hebrewFirstName: "אביגל", itemText: "EPA" }))).rejects.toThrow(/unverified figure/);
  });
});

/**
 * 2026-08-24 review, Uri/MLB draft: the message went out with
 * google.com/goto?url=CAESvQEB… — a search-engine redirect, not the article. The
 * "reproduce the link verbatim" rule worked exactly as written; the input was already
 * wrong. This layer is the last line of defence: whatever reached the draft, the link
 * in the MESSAGE must be the source's own domain.
 */
describe("the link in the message is the source's own domain", () => {
  it("replaces a link the model altered with the canonical source", () => {
    const i = input({ sourceUrl: "https://real.com/story" });
    const r = enforceDraftRules("היי דנה, ראיתי משהו.\nhttps://real.com/story?utm_source=x", i);
    expect(r.ok && r.message.endsWith("\nhttps://real.com/story")).toBe(true);
    expect(r.ok && (r.message.match(/https?:\/\//g) ?? []).length).toBe(1);
  });

  it("appends the link when the model dropped it", () => {
    const r = enforceDraftRules("היי דנה, ראיתי משהו.", input({ sourceUrl: "https://real.com/story" }));
    expect(r.ok && r.message).toBe("היי דנה, ראיתי משהו.\nhttps://real.com/story");
  });

  it("strips a link the model invented when the item has none", () => {
    const r = enforceDraftRules("היי דנה, ראיתי משהו.\nhttps://invented.com/x", input({ sourceUrl: null }));
    expect(r.ok && r.message).toBe("היי דנה, ראיתי משהו.");
  });

  it("rejects outright — not retryably — when the source itself is a redirect", () => {
    const i = input({ sourceUrl: "https://google.com/goto?url=CAESvQEB" });
    const r = enforceDraftRules("היי דנה, ראיתי משהו.\nhttps://google.com/goto?url=CAESvQEB", i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(false);
  });
});

describe("Hebrew the guard knows is wrong", () => {
  // 2026-08-24, Avigal draft: "המפעלות" for refineries. Not a word anyone says.
  it('rejects "מפעלות" and tells the retry to say בתי הזיקוק', () => {
    const i = input({ hebrewFirstName: "אביגל", sourceUrl: null });
    const r = enforceDraftRules("היי אביגל, חשבתי עליך בגלל המפעלות שלכם.", i);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("מפעלות");
      expect(r.instruction).toContain("בתי הזיקוק");
      expect(r.retryable).toBe(true);
    }
  });
});

describe("draftTechMessage and the redirect source", () => {
  it("does not pay for a retry the model cannot win", async () => {
    chat.mockResolvedValue(ok('{"draftMessage":"היי דנה, ראיתי משהו."}'));
    await expect(
      draftTechMessage(input({ sourceUrl: "https://google.com/goto?url=CAES" }))
    ).rejects.toThrow(/search-engine/);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

/**
 * The stored sources for the existing drafts already carry wrapped URLs — the refresh
 * re-drafts from the database without a new scan, so the cleanup has to happen on READ.
 */
describe("firstSourceUrl canonicalization", () => {
  it("skips a search-engine redirect and takes the next real source", () => {
    expect(
      firstSourceUrl([{ url: "https://google.com/goto?url=CAESvQEB" }, { url: "https://real.com/a" }])
    ).toBe("https://real.com/a");
  });

  it("returns null when every source is a redirect that cannot be unwrapped", () => {
    expect(firstSourceUrl([{ url: "https://google.com/goto?url=CAESvQEB" }])).toBeNull();
  });

  it("unwraps and cleans what it returns", () => {
    expect(firstSourceUrl([{ url: "https://www.google.com/url?q=https://real.com/a&ved=x" }])).toBe(
      "https://real.com/a"
    );
    expect(firstSourceUrl([{ url: "https://real.com/a?utm_source=nl&id=3" }])).toBe("https://real.com/a?id=3");
  });
});

/**
 * The refreshed Uri draft (2026-08-24) came back "ראיתי שMLB חתמה" — a Hebrew letter
 * glued to Latin, a rule draft-guard has known since the first production run but
 * nothing at runtime enforced. The separator is deterministic, so it is repaired, not
 * rejected; the rest of draft-guard's rules become retryable rejections.
 */
describe("draft-guard rules run at drafting time", () => {
  it("repairs Hebrew glued to Latin with a hyphen", () => {
    const i = input({ hebrewFirstName: "אורי", sourceUrl: null, itemText: "MLB" });
    const r = enforceDraftRules("היי אורי, ראיתי שMLB חתמה הסכם.", i);
    expect(r.ok && r.message).toBe("היי אורי, ראיתי ש-MLB חתמה הסכם.");
  });

  it("rejects an ask, retryably, naming the violation", () => {
    const r = enforceDraftRules("היי דנה, ראיתי משהו. מה דעתך?", input({ sourceUrl: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("ask");
      expect(r.retryable).toBe(true);
    }
  });
});
