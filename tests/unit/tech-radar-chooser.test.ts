/**
 * Task 8 of the v3 Phase B flow: the chooser — floor 2 of the matching pyramid.
 *
 * Floor 1 (`match-floors.ts`) is tuned for RECALL and says so: an entity hit or a single
 * focused tag makes an item a candidate. That is deliberately generous, because a tag
 * floor exists to prevent a MISS. Preventing MEDIOCRITY is this file's subject, and the
 * Opus veto after it prevents a FAKE. Three floors, three different errors.
 *
 * Everything here is asserted against a MOCKED openrouterChat. There is a live daily
 * budget on that path and a real call from a test run spends real money — the client
 * itself now refuses one (`refuseInsideTests`), which is the backstop, not the plan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const {
  chooseForPerson,
  parseChooserResponse,
  chooserMaxTokens,
  chooserModel,
  CHOOSER_SYSTEM,
  CHOOSER_TIMEOUT_MS,
  MAX_PICKS,
} = await import("@/lib/tech-radar/chooser");

function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}

/** Pazit Garfinkel, the person every failure in the v3 spec was measured on. */
const PAZIT = {
  fullName: "פזית גרפינקל",
  currentTitle: "ראשת החטיבה הקמעונאית",
  employer: "בנק הפועלים",
  roleLens: "מחזיקה את ההצעה לפרטיים ולמשקי בית",
  audience: { type: ["B2C"] as const, who: "משקי בית ולקוחות פרטיים", geography: "ישראל" },
  scope: { owns: ["בנקאות קמעונאית", "אשראי צרכני", "משכנתאות"], notOwns: ["שוקי הון", "בנקאות עסקית"] },
  agenda: { label: "ניוד חשבון ותחרות מול הבנקים הדיגיטליים", personDecision: "חתומה על ההצעה הקמעונאית", dateIso: "2026-07-14" },
  career: {
    tenureYearsInCurrentRole: 3,
    path: [
      { title: "ראשת החטיבה הקמעונאית", company: "בנק הפועלים", years: 3 },
      { title: "מנהלת מוצר דיגיטלי", company: "בנק הפועלים", years: 4 },
    ],
  },
};

function candidate(id: string, title = `כתבה ${id}`) {
  return {
    itemId: id,
    title,
    summary: "סיכום קצר של הכתבה",
    publisher: "globes.co.il",
    kind: "big_news",
    publishedAt: "2026-08-28",
    tier: "focused",
    matched: ["אשראי-צרכני"],
    stature: 0.8,
  };
}

const THREE = [candidate("i1"), candidate("i2"), candidate("i3")];
const IDS = new Set(["i1", "i2", "i3"]);

beforeEach(() => chat.mockReset());

// ─── the prompt ──────────────────────────────────────────────────────────────

describe("CHOOSER_SYSTEM", () => {
  it("caps the picks and makes FEWER the expected answer", () => {
    expect(CHOOSER_SYSTEM).toMatch(new RegExp(`at most ${MAX_PICKS}`, "i"));
    expect(CHOOSER_SYSTEM).toMatch(/fewer/i);
  });

  /** The case this task exists to make first-class: nothing was worth it. */
  it("states that choosing NOTHING is a legitimate answer with a reason", () => {
    expect(CHOOSER_SYSTEM).toMatch(/noneReason/);
    expect(CHOOSER_SYSTEM).toMatch(/legitimate|correct answer/i);
  });

  /** The hallucinated-row failure mode, named in the prompt exactly as triage names it. */
  it("forbids inventing an itemId and says an invented one buys nothing", () => {
    expect(CHOOSER_SYSTEM).toMatch(/never invent/i);
    expect(CHOOSER_SYSTEM).toMatch(/discarded/i);
  });

  it("asks for short casual gender-neutral Hebrew with no icons", () => {
    expect(CHOOSER_SYSTEM).toMatch(/Hebrew/);
    expect(CHOOSER_SYSTEM).toMatch(/gender-neutral/i);
    expect(CHOOSER_SYSTEM).toMatch(/no emoji|no icons/i);
  });

  it("tells it to reject the generic-for-anyone-with-the-title item", () => {
    expect(CHOOSER_SYSTEM).toMatch(/anyone with (their|the same) (job )?title/i);
  });

  /** House tone, enforced on our own copy and not only on the model's. */
  it("carries no emoji itself", () => {
    expect(CHOOSER_SYSTEM).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

// ─── parseChooserResponse — pure ─────────────────────────────────────────────

describe("parseChooserResponse", () => {
  it("reads well-formed picks in the order the model ranked them", () => {
    const r = parseChooserResponse(
      '{"picks":[{"itemId":"i2","why":"נוגע ישירות בניוד חשבון"},{"itemId":"i1","why":"אשראי צרכני"}]}',
      IDS
    );
    expect(r.picks).toEqual([
      { itemId: "i2", why: "נוגע ישירות בניוד חשבון" },
      { itemId: "i1", why: "אשראי צרכני" },
    ]);
    expect(r.outcome).toBe("judged");
    expect(r.noneReason).toBeUndefined();
  });

  /** REQUIRED: a malformed response yields no picks and a reason — never a throw. */
  it("yields no picks and a reason on a malformed response, and does not throw", () => {
    for (const text of ["", "not json at all", "```json\n{oops", '{"picks": "yes"}', "null"]) {
      const r = parseChooserResponse(text, IDS);
      expect(r.picks).toEqual([]);
      expect(r.noneReason).toBeTruthy();
      expect(r.outcome).toBe("parse_failed");
    }
  });

  /**
   * REQUIRED: the hallucinated-row failure mode `parseTriageResponse` already sees in
   * prod. "i9" is not coerced onto the nearest candidate — a coerced pick puts an article
   * in front of a person on a judgement no model ever made.
   */
  it("drops a picked itemId that is not among the candidates and keeps the valid ones", () => {
    const r = parseChooserResponse(
      '{"picks":[{"itemId":"i9","why":"המצאה"},{"itemId":"i1","why":"אמיתי"}]}',
      IDS
    );
    expect(r.picks).toEqual([{ itemId: "i1", why: "אמיתי" }]);
  });

  it("does not coerce an off-list id to the nearest candidate", () => {
    const r = parseChooserResponse('{"picks":[{"itemId":"i1x","why":"כמעט"}]}', IDS);
    expect(r.picks).toEqual([]);
    expect(r.noneReason).toBeTruthy();
    // A fault, not a judgement: nothing the model chose survived validation.
    expect(r.outcome).toBe("parse_failed");
  });

  /** REQUIRED: "none are worth it" is an ANSWER, and it is recorded as one. */
  it("records a deliberate none with its reason, distinct from a parse failure", () => {
    const r = parseChooserResponse('{"picks":[],"noneReason":"אין כאן שום דבר שקשור למה שהיא מחזיקה"}', IDS);
    expect(r.picks).toEqual([]);
    expect(r.noneReason).toBe("אין כאן שום דבר שקשור למה שהיא מחזיקה");
    expect(r.outcome).toBe("none");
  });

  it("accepts a none answer that omits the picks key entirely", () => {
    const r = parseChooserResponse('{"noneReason":"הכל גנרי"}', IDS);
    expect(r.outcome).toBe("none");
    expect(r.noneReason).toBe("הכל גנרי");
  });

  it("caps the picks at MAX_PICKS", () => {
    const many = [...IDS].map((id) => ({ itemId: id, why: `כי ${id}` }));
    const r = parseChooserResponse(JSON.stringify({ picks: [...many, { itemId: "i1", why: "שוב" }] }), IDS);
    expect(r.picks.length).toBeLessThanOrEqual(MAX_PICKS);
  });

  it("keeps one pick per item when the model repeats an id", () => {
    const r = parseChooserResponse(
      '{"picks":[{"itemId":"i1","why":"ראשון"},{"itemId":"i1","why":"שוב אותו דבר"}]}',
      IDS
    );
    expect(r.picks).toEqual([{ itemId: "i1", why: "ראשון" }]);
  });

  /** A pick with no reason is not a judgement, and `why` is what the reviewer reads. */
  it("drops a pick with an empty why", () => {
    const r = parseChooserResponse('{"picks":[{"itemId":"i1","why":"   "},{"itemId":"i2","why":"טוב"}]}', IDS);
    expect(r.picks).toEqual([{ itemId: "i2", why: "טוב" }]);
  });

  it("ignores a noneReason that arrives alongside real picks", () => {
    const r = parseChooserResponse('{"picks":[{"itemId":"i1","why":"טוב"}],"noneReason":"אין כלום"}', IDS);
    expect(r.picks).toHaveLength(1);
    expect(r.noneReason).toBeUndefined();
  });

  /** parseJsonLoose salvages whole elements from output cut off mid-array. */
  it("recovers the complete picks from JSON truncated mid-array", () => {
    const r = parseChooserResponse('{"picks":[{"itemId":"i1","why":"טוב"},{"itemId":"i2","why":"חתו', IDS);
    expect(r.picks).toEqual([{ itemId: "i1", why: "טוב" }]);
  });

  it("carries no emoji in its own fallback reasons", () => {
    expect(parseChooserResponse("garbage", IDS).noneReason).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

// ─── chooseForPerson — one mocked call ───────────────────────────────────────

describe("chooseForPerson", () => {
  it("makes exactly ONE call, on Haiku, and returns the picks", async () => {
    chat.mockResolvedValue(ok('{"picks":[{"itemId":"i2","why":"ניוד חשבון"}]}'));
    const r = await chooseForPerson(PAZIT, THREE);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(String(chat.mock.calls[0][1].model)).toMatch(/haiku/);
    expect(r.picks).toEqual([{ itemId: "i2", why: "ניוד חשבון" }]);
  });

  it("hands the model the whole person — scope, audience, agenda and career", async () => {
    chat.mockResolvedValue(ok('{"picks":[]}'));
    await chooseForPerson(PAZIT, THREE);
    const user = String(chat.mock.calls[0][1].messages[1].content);
    expect(user).toContain("פזית גרפינקל");
    expect(user).toContain("בנקאות קמעונאית"); // owns
    expect(user).toContain("שוקי הון"); // notOwns
    expect(user).toContain("משקי בית ולקוחות פרטיים"); // audience.who
    expect(user).toContain("ישראל"); // audience.geography
    expect(user).toContain("ניוד חשבון"); // agenda
    expect(user).toMatch(/3/); // tenure
  });

  it("hands the model every candidate that cleared the floors, by id", async () => {
    chat.mockResolvedValue(ok('{"picks":[]}'));
    await chooseForPerson(PAZIT, THREE);
    const user = String(chat.mock.calls[0][1].messages[1].content);
    for (const c of THREE) expect(user).toContain(c.itemId);
  });

  /**
   * Bug (c) from the 2026-08-31 live run: `??` does not fall through for a helper that
   * returns "". An unresearched scope must render the explicit "not researched" line, not
   * an empty one the model reads as "she owns nothing".
   */
  it("says so explicitly when the scope is empty rather than rendering a blank line", async () => {
    chat.mockResolvedValue(ok('{"picks":[]}'));
    await chooseForPerson({ ...PAZIT, scope: { owns: [], notOwns: [] }, audience: null }, THREE);
    const user = String(chat.mock.calls[0][1].messages[1].content);
    expect(user).toMatch(/not researched/i);
  });

  /** Bug (a): a ceiling that does not fit the work truncates the JSON and is billed anyway. */
  it("budgets output tokens generously and grows the budget with the candidate count", () => {
    expect(chooserMaxTokens(3)).toBeGreaterThan(1000);
    expect(chooserMaxTokens(40)).toBeGreaterThan(chooserMaxTokens(3));
  });

  it("passes that budget and a generous timeout to openrouterChat", async () => {
    chat.mockResolvedValue(ok('{"picks":[]}'));
    await chooseForPerson(PAZIT, THREE);
    expect(chat.mock.calls[0][1].max_tokens).toBe(chooserMaxTokens(3));
    // Bug (b): 90s produced an AbortError mid-generation, after the call was paid for.
    expect(CHOOSER_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    expect(chat.mock.calls[0][2].timeoutMs).toBe(CHOOSER_TIMEOUT_MS);
  });

  it("asks for json_object at temperature 0", async () => {
    chat.mockResolvedValue(ok('{"picks":[]}'));
    await chooseForPerson(PAZIT, THREE);
    expect(chat.mock.calls[0][1].response_format).toEqual({ type: "json_object" });
    expect(chat.mock.calls[0][1].temperature).toBe(0);
  });

  /** A failed call is not a pick and not a throw — the veto's discipline. */
  it("returns no picks with a reason when the call fails, and never throws", async () => {
    chat.mockResolvedValue({ ok: false, status: 502, detail: "bad gateway" });
    const r = await chooseForPerson(PAZIT, THREE);
    expect(r.picks).toEqual([]);
    expect(r.noneReason).toContain("502");
    expect(r.outcome).toBe("unavailable");
  });

  it("spends nothing when nothing cleared the floors", async () => {
    const r = await chooseForPerson(PAZIT, []);
    expect(chat).not.toHaveBeenCalled();
    expect(r.picks).toEqual([]);
    expect(r.noneReason).toBeTruthy();
    expect(r.outcome).toBe("none");
  });

  it("drops a hallucinated id end to end", async () => {
    chat.mockResolvedValue(ok('{"picks":[{"itemId":"totally-made-up","why":"לא קיים"}]}'));
    const r = await chooseForPerson(PAZIT, THREE);
    expect(r.picks).toEqual([]);
    expect(r.noneReason).toBeTruthy();
  });

  it("records a model-declared none as a decision", async () => {
    chat.mockResolvedValue(ok('{"picks":[],"noneReason":"אין השבוע משהו ששווה להעביר"}'));
    const r = await chooseForPerson(PAZIT, THREE);
    expect(r).toMatchObject({ picks: [], noneReason: "אין השבוע משהו ששווה להעביר", outcome: "none" });
  });

  it("honours TECH_RADAR_CHOOSER_MODEL and ignores an empty one", () => {
    const prev = process.env.TECH_RADAR_CHOOSER_MODEL;
    try {
      process.env.TECH_RADAR_CHOOSER_MODEL = "anthropic/claude-haiku-9";
      expect(chooserModel()).toBe("anthropic/claude-haiku-9");
      process.env.TECH_RADAR_CHOOSER_MODEL = "";
      expect(chooserModel()).toMatch(/haiku/);
    } finally {
      if (prev === undefined) delete process.env.TECH_RADAR_CHOOSER_MODEL;
      else process.env.TECH_RADAR_CHOOSER_MODEL = prev;
    }
  });
});
