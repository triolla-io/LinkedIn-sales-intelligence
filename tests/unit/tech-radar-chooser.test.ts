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
  chooserUserPrompt,
  entityPickPasses,
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

// ─── the entity-MENTION gate ─────────────────────────────────────────────────
//
// The 2026-08-31 live run, second failure: two drafts reached the Opus veto and Opus
// killed both, in both cases because the only link between the person and the article was
// that a bank on the person's entity list was NAMED in it — "תגית מתחרה כללית",
// "ההתאמה נשענה רק על תגית בנק הפועלים ללא קשר ממשי להחלטה או לבעלות". Floor 1 passes an
// entity hit with no stature check by design; floor 2 is where that has to be caught, and
// the most expensive call in the pipeline had to do floor 2's job instead.
//
// The distinction being pinned: a competitor NAMED in a story is not a story ABOUT
// something that competitor DID that bears on this person's own lines.

/** The good case, and the one the recall side is pinned on: a rival moved on HER subject. */
const LEUMI_ONBOARDING = {
  itemId: "e1",
  title: "בנק לאומי השיק תהליך פתיחת חשבון דיגיטלי ללקוחות פרטיים חדשים",
  summary: "הבנק פתח מסלול הצטרפות מלא באפליקציה ללקוחות חדשים",
  publisher: "globes.co.il",
  publishedAt: "2026-08-28",
  kind: "big_news",
  tier: "entity",
  matched: ["בנק לאומי"],
  stature: 0.7,
};

/** The item that actually reached the veto twice: her tag matched a bank's NAME. */
const DISCOUNT_PALESTINIAN = {
  itemId: "e2",
  title: "בנק דיסקונט דחה את הפסקת שירותי בנקאות לפלסטינים",
  summary: "שירותי correspondent banking לבנקים פלסטיניים, תחום מוסדי-רגולטורי",
  publisher: "globes.co.il",
  publishedAt: "2026-08-29",
  kind: "big_news",
  tier: "entity",
  matched: ["בנק דיסקונט"],
  stature: 0.6,
};

/** Pazit with the line the good item lands on written into her scope. */
const PAZIT_ONBOARDING = {
  ...PAZIT,
  scope: { owns: [...PAZIT.scope.owns, "פתיחת חשבון דיגיטלית"], notOwns: PAZIT.scope.notOwns },
};

const ENTITY_GATE = {
  validIds: new Set(["e1", "e2"]),
  tierById: new Map([
    ["e1", "entity"],
    ["e2", "entity"],
  ]),
  matchedById: new Map([
    ["e1", ["בנק לאומי"]],
    ["e2", ["בנק דיסקונט"]],
  ]),
  heldLines: PAZIT_ONBOARDING.scope.owns,
};

describe("CHOOSER_SYSTEM — the entity tier is a mention until proven otherwise", () => {
  it("names the entity tier and says a printed name is not news on its own", () => {
    expect(CHOOSER_SYSTEM).toMatch(/tier=entity/);
    expect(CHOOSER_SYSTEM).toMatch(/NAMES|named/);
    expect(CHOOSER_SYSTEM).toMatch(/mention/i);
  });

  it("demands the action and the line, and says the pick is dropped in code without them", () => {
    expect(CHOOSER_SYSTEM).toMatch(/\bdid\b/);
    expect(CHOOSER_SYSTEM).toMatch(/bearsOn/);
    expect(CHOOSER_SYSTEM).toMatch(/discarded in code|dropped in code/i);
    // bearsOn is copied, not paraphrased — the itemId discipline, applied to the line.
    expect(CHOOSER_SYSTEM).toMatch(/COPIED|copy/);
  });

  it("carries both halves of the distinction as worked examples", () => {
    expect(CHOOSER_SYSTEM).toMatch(/institutional|regulatory|geopolitical/i);
    expect(CHOOSER_SYSTEM).toMatch(/onboarding|account opening/i);
  });

  /** The hardening must not become pressure to pick. Rejecting all four was CORRECT. */
  it("keeps nothing a full answer under the entity rule too", () => {
    expect(CHOOSER_SYSTEM).toMatch(/still a (full|legitimate|correct) answer/i);
  });

  it("carries no emoji in the new copy either", () => {
    expect(CHOOSER_SYSTEM).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("chooserUserPrompt — the entity candidate is flagged where the model reads it", () => {
  it("marks an entity-tier candidate as a mention and leaves a focused one alone", () => {
    const user = chooserUserPrompt(PAZIT_ONBOARDING, [LEUMI_ONBOARDING, candidate("i1")]);
    const [entityBlock, focusedBlock] = [user.slice(0, user.indexOf("2. itemId=")), user.slice(user.indexOf("2. itemId="))];
    expect(entityBlock).toMatch(/entity tier/i);
    expect(entityBlock).toMatch(/NAMES/);
    expect(focusedBlock).not.toMatch(/entity tier/i);
  });
});

describe("entityPickPasses", () => {
  const ctx = { matched: ["בנק לאומי"], heldLines: PAZIT_ONBOARDING.scope.owns };

  /** THE RECALL PIN: the rival moved on her own subject, and the pick survives. */
  it("passes the rival-moved-on-her-subject pick, inflection and extra words included", () => {
    expect(
      entityPickPasses(
        { did: "השיק תהליך פתיחת חשבון דיגיטלי מלא באפליקציה", bearsOn: "פתיחת חשבון דיגיטלי ללקוחות חדשים" },
        ctx
      )
    ).toEqual({ ok: true });
  });

  it("passes a bearsOn copied verbatim off the owns list", () => {
    expect(entityPickPasses({ did: "השיק מסלול אשראי חדש", bearsOn: "אשראי צרכני" }, ctx)).toEqual({ ok: true });
  });

  it("rejects a pick that names no action at all", () => {
    expect(entityPickPasses({ bearsOn: "בנקאות קמעונאית" }, ctx)).toEqual({ ok: false, reason: "no_action" });
    expect(entityPickPasses({ did: "   ", bearsOn: "בנקאות קמעונאית" }, ctx)).toEqual({ ok: false, reason: "no_action" });
  });

  it("rejects an action that is only the entity's own name", () => {
    expect(entityPickPasses({ did: "בנק לאומי", bearsOn: "בנקאות קמעונאית" }, ctx)).toMatchObject({
      ok: false,
      reason: "action_is_only_the_name",
    });
    expect(entityPickPasses({ did: "בנק לאומי מוזכר", bearsOn: "בנקאות קמעונאית" }, ctx)).toMatchObject({
      ok: false,
      reason: "action_is_only_the_name",
    });
  });

  it("rejects a line the person does not hold, and a missing line", () => {
    expect(entityPickPasses({ did: "דחה את הפסקת השירותים לבנקים פלסטיניים", bearsOn: "בנקאות מוסדית וסחר חוץ" }, ctx)).toEqual({
      ok: false,
      reason: "line_not_held",
    });
    expect(entityPickPasses({ did: "דחה את הפסקת השירותים לבנקים פלסטיניים" }, ctx)).toEqual({
      ok: false,
      reason: "line_not_held",
    });
  });

  /**
   * An unresearched scope is not a verdict. `line()` already refuses to let an empty
   * field read as a fact; the gate refuses to let it read as a rejection — the shape is
   * still required, the membership check simply has nothing to check against.
   */
  it("requires the shape but not the membership when the person's lines were never researched", () => {
    expect(entityPickPasses({ did: "השיק מסלול חדש", bearsOn: "משהו אחר" }, { matched: ["בנק לאומי"] })).toEqual({ ok: true });
    expect(entityPickPasses({ did: "השיק מסלול חדש" }, { matched: ["בנק לאומי"], heldLines: [] })).toEqual({
      ok: false,
      reason: "line_not_held",
    });
  });
});

describe("parseChooserResponse — the gate, per candidate tier", () => {
  it("keeps the good entity pick and carries its did and bearsOn through", () => {
    const r = parseChooserResponse(
      JSON.stringify({
        picks: [
          {
            itemId: "e1",
            why: "לאומי פתח מסלול הצטרפות דיגיטלי מלא, בדיוק בקו שאת/ה מחזיק/ה",
            did: "השיק תהליך פתיחת חשבון דיגיטלי ללקוחות חדשים",
            bearsOn: "פתיחת חשבון דיגיטלית",
          },
        ],
      }),
      ENTITY_GATE
    );
    expect(r.outcome).toBe("judged");
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0]).toMatchObject({ itemId: "e1", did: expect.stringContaining("השיק"), bearsOn: "פתיחת חשבון דיגיטלית" });
  });

  it("drops the bare-mention entity pick and records it as a mention, not as taste", () => {
    const r = parseChooserResponse(
      '{"picks":[{"itemId":"e2","why":"תגית מתחרה"}]}',
      ENTITY_GATE
    );
    expect(r.picks).toEqual([]);
    expect(r.outcome).toBe("mention_only");
    expect(r.noneReason).toBeTruthy();
    expect(r.noneReason).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("drops an entity pick whose line is not one the person holds", () => {
    const r = parseChooserResponse(
      JSON.stringify({
        picks: [
          {
            itemId: "e2",
            why: "ידיעה גדולה",
            did: "דחה את הפסקת שירותי correspondent banking לבנקים פלסטיניים",
            bearsOn: "בנקאות מוסדית וסחר חוץ",
          },
        ],
      }),
      ENTITY_GATE
    );
    expect(r.picks).toEqual([]);
    expect(r.outcome).toBe("mention_only");
  });

  it("keeps a good entity pick alongside a dropped one", () => {
    const r = parseChooserResponse(
      JSON.stringify({
        picks: [
          { itemId: "e2", why: "מוזכר בנק מהרשימה" },
          { itemId: "e1", why: "לאומי זז על הקו שלה", did: "השיק פתיחת חשבון דיגיטלית", bearsOn: "בנקאות קמעונאית" },
        ],
      }),
      ENTITY_GATE
    );
    expect(r.picks.map((p) => p.itemId)).toEqual(["e1"]);
    expect(r.outcome).toBe("judged");
  });

  /** No regression: only the entity tier is gated. A focused hit is the person's own tag. */
  it("leaves a focused-tier pick untouched and adds no fields to it", () => {
    const r = parseChooserResponse('{"picks":[{"itemId":"i1","why":"אשראי צרכני, הקו שלה"}]}', {
      validIds: IDS,
      tierById: new Map([["i1", "focused"]]),
      heldLines: PAZIT.scope.owns,
    });
    expect(r.picks).toEqual([{ itemId: "i1", why: "אשראי צרכני, הקו שלה" }]);
    expect(r.outcome).toBe("judged");
  });

  it("still takes a plain Set of ids, ungated", () => {
    const r = parseChooserResponse('{"picks":[{"itemId":"i1","why":"טוב"}]}', IDS);
    expect(r.picks).toEqual([{ itemId: "i1", why: "טוב" }]);
  });

  /** A mention drop must not mask a fault: an invented id is still a bug, and reads as one. */
  it("reports a fault ahead of a mention drop when the model also invented an id", () => {
    const r = parseChooserResponse(
      '{"picks":[{"itemId":"e9","why":"המצאה"},{"itemId":"e2","why":"מוזכר"}]}',
      ENTITY_GATE
    );
    expect(r.picks).toEqual([]);
    expect(r.outcome).toBe("parse_failed");
  });

  /** The model's own none is untouched by any of this. */
  it("leaves a declared none a decision", () => {
    const r = parseChooserResponse('{"picks":[],"noneReason":"רק אזכורי שם, אין מה להעביר"}', ENTITY_GATE);
    expect(r).toMatchObject({ picks: [], outcome: "none", noneReason: "רק אזכורי שם, אין מה להעביר" });
  });
});

describe("chooseForPerson — the gate is built from the person and the candidates", () => {
  it("kills the 2026-08-31 draft end to end: an entity tag with no action and no line", async () => {
    chat.mockResolvedValue(ok('{"picks":[{"itemId":"e2","why":"תגית בנק הפועלים"}]}'));
    const r = await chooseForPerson(PAZIT_ONBOARDING, [LEUMI_ONBOARDING, DISCOUNT_PALESTINIAN]);
    expect(r.picks).toEqual([]);
    expect(r.outcome).toBe("mention_only");
    expect(r.noneReason).toBeTruthy();
  });

  /** THE RECALL PIN, end to end: the rival's move on her own line still gets through. */
  it("lets the rival-moved-on-her-subject pick through end to end", async () => {
    chat.mockResolvedValue(
      ok(
        JSON.stringify({
          picks: [
            {
              itemId: "e1",
              why: "לאומי השיק פתיחת חשבון דיגיטלית, בדיוק הקו שבאחריות",
              did: "השיק תהליך פתיחת חשבון דיגיטלי ללקוחות פרטיים חדשים",
              bearsOn: "פתיחת חשבון דיגיטלית",
            },
          ],
        })
      )
    );
    const r = await chooseForPerson(PAZIT_ONBOARDING, [LEUMI_ONBOARDING, DISCOUNT_PALESTINIAN]);
    expect(r.outcome).toBe("judged");
    expect(r.picks.map((p) => p.itemId)).toEqual(["e1"]);
  });

  /** The agenda is a line they hold too — it is what they are living through right now. */
  it("accepts a bearsOn taken off the agenda, not only off the owns list", async () => {
    chat.mockResolvedValue(
      ok(
        JSON.stringify({
          picks: [
            {
              itemId: "e1",
              why: "נוגע לניוד חשבון",
              did: "השיק מסלול ניוד חשבון מהיר",
              bearsOn: "ניוד חשבון ותחרות מול הבנקים הדיגיטליים",
            },
          ],
        })
      )
    );
    const r = await chooseForPerson(PAZIT_ONBOARDING, [LEUMI_ONBOARDING]);
    expect(r.outcome).toBe("judged");
    expect(r.picks).toHaveLength(1);
  });
});
