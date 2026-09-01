import { afterEach, describe, expect, it } from "vitest";
import {
  BROAD_STATURE_FLOOR,
  MIN_BROAD_TAGS,
  entityHit,
  floorThresholds,
  prefilter,
  passesFloors,
  tagOverlap,
  type FloorItem,
  type FloorPerson,
} from "@/lib/tech-radar/match-floors";
import { INDUSTRY_ONLY_STATURE_FLOOR } from "@/lib/tech-radar/layers";

/**
 * Pazit Garfinkel, Head of Retail Banking at Bank Hapoalim, exactly as prod holds her on
 * 2026-08-31. Every case below is one of the four real failures her row exposed.
 */
const PAZIT: FloorPerson = {
  industryKey: "בנקאות ישראל",
  audience: { type: ["B2C"], who: "משקי בית ולקוחות פרטיים", geography: "ישראל" },
  scope: {
    owns: ["בנקאות קמעונאית", "אשראי צרכני", "משכנתאות", "ערוצים דיגיטליים לפרטיים"],
    notOwns: ["שוקי הון", "בנקאות עסקית", "בנקאות תאגידית"],
  },
};

function item(over: Partial<FloorItem> & { title: string }): FloorItem {
  return { summary: "", url: null, industryKey: "בנקאות ישראל", industryTags: [], ...over };
}

afterEach(() => {
  delete process.env.RADAR_MIN_BROAD_TAGS;
  delete process.env.RADAR_BROAD_STATURE_FLOOR;
});

describe("prefilter — the industry pack", () => {
  it("drops an item pulled for another industry's pack", () => {
    // "כתבה מחבילת בנקאות לא נמדדת מול איש H&M", and the reverse.
    const v = prefilter(item({ title: "H&M opens 30 stores", industryKey: "אופנה קמעונאית" }), PAZIT);
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("industry_mismatch");
  });

  it("matches a reordered pack key — normalizeAxisKey token-sorts, so word order cannot split a pack", () => {
    const v = prefilter(
      item({ title: "בנק ישראל פרסם הוראה חדשה", industryKey: "ישראל בנקאות" }),
      PAZIT
    );
    expect(v.pass).toBe(true);
  });

  it("does not judge the pack when either side has none — an unknown pack is not a mismatch", () => {
    expect(prefilter(item({ title: "בנק ישראל", industryKey: null }), PAZIT).pass).toBe(true);
    expect(prefilter(item({ title: "בנק ישראל" }), { ...PAZIT, industryKey: null }).pass).toBe(true);
  });
});

describe("prefilter — scope.notOwns", () => {
  it("kills a capital-markets story for Pazit BEFORE any LLM is asked", () => {
    // The whole reason the floors run first. She does not hold שוקי הון; today every
    // company subject stays eligible for everyone, and this story would have been
    // triaged, tagged, chosen and vetoed — four paid stages — to reach the same no.
    const v = prefilter(
      item({
        title: "הפועלים מרחיב את זרוע שוקי ההון ומגייס חתמים",
        summary: "המהלך נועד להגדיל את נתח החברה בהנפקות בבורסה בתל אביב",
      }),
      PAZIT
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("not_owned");
    expect(v.detail).toBe("שוקי הון");
  });

  it("matches an inflected line — the press writes שוק ההון, the profile wrote שוקי הון", () => {
    const v = prefilter(item({ title: "רפורמה בשוק ההון הישראלי" }), PAZIT);
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("not_owned");
  });

  it("matches the English spelling of the same line", () => {
    const v = prefilter(
      item({
        title: "Israeli banks push into capital markets underwriting",
        summary: "",
        industryKey: "בנקאות ישראל",
      }),
      { ...PAZIT, scope: { owns: [], notOwns: ["capital markets"] } }
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("not_owned");
  });

  it("leaves a story about a line she DOES own alone", () => {
    const v = prefilter(
      item({ title: "הפועלים משיק אשראי צרכני מיידי באפליקציה", summary: "לקוחות פרטיים" }),
      PAZIT
    );
    expect(v.pass).toBe(true);
  });

  it("passes everything when the scope is empty — an unknown remit is a weaker filter, not a wrong person", () => {
    const v = prefilter(item({ title: "רפורמה בשוק ההון" }), { ...PAZIT, scope: null });
    expect(v.pass).toBe(true);
  });
});

describe("prefilter — geography against the audience", () => {
  it("fails a Philippine retail-bank feature for Pazit — the story this gate exists to stop", () => {
    // The literal complaint: "כתבות על בנק בפיליפינים מוצעות לראשת בנקאות קמעונאית
    // בבנק הפועלים". Nothing in the pipeline ever asked whether the item was in her
    // market, so a correct-subject story from 8,000km away scored like a local one.
    const v = prefilter(
      item({
        title: "Philippine lender UnionBank launches instant onboarding in its retail app",
        summary: "The Manila-based bank said customers can now open an account in five minutes",
        url: "https://fintechfutures.com/2026/08/unionbank-onboarding",
      }),
      PAZIT
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("foreign_local");
    expect(v.detail).toContain("philippine");
  });

  it("passes a global BIS regulatory report for the same person", () => {
    // A worldwide regulatory paper travels: it lands on Israeli banking too, and it is
    // the kind of thing a Head of Retail Banking forwards.
    const v = prefilter(
      item({
        title: "BIS report: retail deposit behaviour is changing across advanced economies",
        summary: "The Bank for International Settlements surveyed 40 jurisdictions",
        url: "https://www.bis.org/publ/2026.htm",
      }),
      PAZIT
    );
    expect(v.pass).toBe(true);
  });

  it("passes an IMF paper that names foreign countries — a global marker outranks a foreign one", () => {
    const v = prefilter(
      item({
        title: "IMF warns on household credit growth in Brazil, Indonesia and the Philippines",
        summary: "The Fund's global financial stability review",
      }),
      PAZIT
    );
    expect(v.pass).toBe(true);
  });

  it("passes a story about a global major player, even though the country is foreign", () => {
    const v = prefilter(
      item({ title: "JPMorgan rebuilds its consumer onboarding", summary: "The US bank said…" }),
      { ...PAZIT, globalPlayers: ["JPMorgan", "ג'יי פי מורגן"] }
    );
    expect(v.pass).toBe(true);
  });

  it("passes an Israeli story, whatever else it names", () => {
    const v = prefilter(
      item({
        title: "בנק הפועלים משיק ניוד חשבון בשלוש דקות",
        summary: "בעקבות מודל שנוסה בפיליפינים",
        url: "https://www.globes.co.il/news/article.aspx?did=1001",
      }),
      PAZIT
    );
    expect(v.pass).toBe(true);
  });

  it("passes a placeless story — the only geography failure is a NAMED foreign market", () => {
    const v = prefilter(
      item({ title: "Why retail customers abandon digital onboarding halfway through" }),
      PAZIT
    );
    expect(v.pass).toBe(true);
  });

  it("skips the geography check entirely for an INTERNAL audience with no country", () => {
    // A CITO's audience is the company's own units. It has no country, and inventing
    // one would manufacture exactly the claim this filter is about to trust.
    const cito: FloorPerson = {
      industryKey: "בנקאות ישראל",
      audience: { type: ["INTERNAL"], who: "יחידות הבנק", geography: "" },
      scope: { owns: ["מערכות ליבה"], notOwns: [] },
    };
    const v = prefilter(item({ title: "Philippine lender UnionBank migrates its core" }), cito);
    expect(v.pass).toBe(true);
  });

  it("skips the geography check for a market it has no lexicon for, rather than guessing", () => {
    const spanish: FloorPerson = {
      ...PAZIT,
      industryKey: null,
      audience: { type: ["B2C"], who: "hogares", geography: "España" },
    };
    const v = prefilter(item({ title: "Philippine lender UnionBank launches app", industryKey: null }), spanish);
    expect(v.pass).toBe(true);
  });

  it("checks notOwns BEFORE geography, so the cheapest certain no is the one reported", () => {
    // Both floors would reject this. The reported reason has to be the one that is true
    // of her REMIT, because that is the one no threshold will ever move.
    const v = prefilter(
      item({ title: "רגולטור שוקי ההון בפיליפינים מקל על חתמים" }),
      PAZIT
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("not_owned");
  });
});

describe("entityHit", () => {
  const ENTITIES = [
    { name: "One Zero", aliases: ["וואן זירו", "OneZero"] },
    { name: "Pepper", aliases: ["פפר"] },
  ];

  it("hits on the canonical name in the title", () => {
    expect(entityHit(item({ title: "One Zero passes 200,000 customers" }), ENTITIES)).toBe("One Zero");
  });

  it("hits on the Hebrew alias, which is how Israeli press actually spells it", () => {
    expect(entityHit(item({ title: "וואן זירו עברה 200 אלף לקוחות" }), ENTITIES)).toBe("One Zero");
  });

  it("hits on a name that appears only in the summary", () => {
    expect(
      entityHit(item({ title: "בנק דיגיטלי חדש מדווח על צמיחה", summary: "פפר הודיעה על…" }), ENTITIES)
    ).toBe("Pepper");
  });

  it("returns null for somebody who does not track it — a hit belongs to whoever tracks the name", () => {
    // The same headline. Elinor watches Harel and Migdal, so "One Zero" is not her news.
    expect(entityHit(item({ title: "One Zero passes 200,000 customers" }), [
      { name: "הראל", aliases: ["Harel"] },
    ])).toBeNull();
  });

  it("returns null with no entities at all", () => {
    expect(entityHit(item({ title: "One Zero passes 200,000 customers" }), [])).toBeNull();
  });

  it("does not read לאומי out of בינלאומי — the FIBI trap that invalidEntityTags is exact for", () => {
    expect(entityHit(item({ title: "הבנק הבינלאומי הראשון מדווח על רבעון" }), [
      { name: "Bank Leumi", aliases: ["בנק לאומי", "לאומי"] },
    ])).toBeNull();
  });

  it("still matches לאומי inside בנק לאומי, and with a glued Hebrew prefix", () => {
    const entities = [{ name: "Bank Leumi", aliases: ["בנק לאומי", "לאומי"] }];
    expect(entityHit(item({ title: "בנק לאומי משיק אשראי מיידי" }), entities)).toBe("Bank Leumi");
    expect(entityHit(item({ title: "המהלך בלאומי מגיע אחרי רבעון חלש" }), entities)).toBe("Bank Leumi");
  });

  it("matches a multi-word name only when the words are adjacent", () => {
    expect(entityHit(item({ title: "Zero fees at One Bank" }), [{ name: "One Zero", aliases: [] }])).toBeNull();
  });

  it("does not match a name inside a longer word", () => {
    expect(entityHit(item({ title: "Peppermint raises a round" }), [{ name: "Pepper", aliases: [] }])).toBeNull();
  });

  it("ignores a one-character form rather than matching every headline", () => {
    expect(entityHit(item({ title: "A new bank opens" }), [{ name: "A", aliases: [] }])).toBeNull();
  });
});

describe("tagOverlap", () => {
  const TAGS = {
    focused: ["אשראי-צרכני", "משכנתאות"],
    broad: ["רגולציה-ישראל", "תשלומים", "KYC-ואימות"],
    entities: [{ name: "One Zero", aliases: ["וואן זירו"] }],
  };

  it("an entity hit outranks every tag — the strongest signal there is", () => {
    const out = tagOverlap(
      item({ title: "וואן זירו משיקה משכנתה", industryTags: ["משכנתאות", "רגולציה-ישראל"] }),
      TAGS
    );
    expect(out.tier).toBe("entity");
    expect(out.matched).toEqual(["One Zero"]);
  });

  it("one focused tag is the focused tier, and broad tags on the same item do not dilute it", () => {
    const out = tagOverlap(
      item({ title: "אשראי צרכני", industryTags: ["אשראי-צרכני", "תשלומים"] }),
      TAGS
    );
    expect(out.tier).toBe("focused");
    expect(out.matched).toEqual(["אשראי-צרכני"]);
  });

  it("broad tags alone are the broad tier, and every one of them is reported", () => {
    const out = tagOverlap(item({ title: "הוראת ניהול בנקאי חדשה", industryTags: ["רגולציה-ישראל", "תשלומים"] }), TAGS);
    expect(out.tier).toBe("broad");
    expect(out.matched).toEqual(["רגולציה-ישראל", "תשלומים"]);
  });

  it("is 'none' with an empty matched list when nothing overlaps", () => {
    expect(tagOverlap(item({ title: "משהו אחר", industryTags: ["ביטוח-חיים"] }), TAGS)).toEqual({
      tier: "none",
      matched: [],
    });
  });

  it("is 'none' for an untagged item — triage tagging nothing is not a match", () => {
    expect(tagOverlap(item({ title: "משהו" }), TAGS).tier).toBe("none");
  });

  it("compares tags case- and whitespace-insensitively, and never counts one twice", () => {
    const out = tagOverlap(
      item({ title: "x", industryTags: [" KYC-ואימות ", "kyc-ואימות"] }),
      TAGS
    );
    expect(out.tier).toBe("broad");
    expect(out.matched).toEqual(["KYC-ואימות"]);
  });
});

describe("passesFloors", () => {
  const entity = { tier: "entity" as const, matched: ["One Zero"] };
  const focused = { tier: "focused" as const, matched: ["אשראי-צרכני"] };
  const twoBroad = { tier: "broad" as const, matched: ["רגולציה-ישראל", "תשלומים"] };
  const oneBroad = { tier: "broad" as const, matched: ["רגולציה-ישראל"] };

  it("an entity hit is a candidate at any stature", () => {
    const v = passesFloors({ overlap: entity, stature: 0.1 });
    expect(v.pass).toBe(true);
    expect(v.reason).toBe("entity_hit");
  });

  it("one focused tag is a candidate at any stature", () => {
    const v = passesFloors({ overlap: focused, stature: 0.1 });
    expect(v.pass).toBe(true);
    expect(v.reason).toBe("focused_tag");
  });

  it("two broad tags at stature 0.6 FAIL — the industry floor, expressed in tags", () => {
    const v = passesFloors({ overlap: twoBroad, stature: 0.6 });
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("broad_low_stature");
  });

  it("two broad tags at stature 0.9 PASS", () => {
    const v = passesFloors({ overlap: twoBroad, stature: 0.9 });
    expect(v.pass).toBe(true);
    expect(v.reason).toBe("broad_tags");
  });

  it("passes exactly at the floor, which is layers.ts's INDUSTRY_ONLY_STATURE_FLOOR and not a second copy of it", () => {
    expect(BROAD_STATURE_FLOOR).toBe(INDUSTRY_ONLY_STATURE_FLOOR);
    expect(passesFloors({ overlap: twoBroad, stature: BROAD_STATURE_FLOOR }).pass).toBe(true);
  });

  it("one broad tag fails on the count even at high stature", () => {
    const v = passesFloors({ overlap: oneBroad, stature: 0.95 });
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("broad_too_few");
  });

  it("no overlap is never a candidate", () => {
    const v = passesFloors({ overlap: { tier: "none", matched: [] }, stature: 1 });
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("no_tag");
  });

  it("carries the tier through, so a saved drop-out says which floor it died on", () => {
    expect(passesFloors({ overlap: twoBroad, stature: 0.6 }).tier).toBe("broad");
  });
});

describe("floorThresholds", () => {
  it("defaults to two broad tags and the existing industry stature floor", () => {
    expect(floorThresholds()).toEqual({
      minBroad: MIN_BROAD_TAGS,
      broadStatureFloor: BROAD_STATURE_FLOOR,
    });
    expect(MIN_BROAD_TAGS).toBe(2);
  });

  it("honours env overrides, so the bar can be calibrated without a deploy", () => {
    process.env.RADAR_MIN_BROAD_TAGS = "3";
    process.env.RADAR_BROAD_STATURE_FLOOR = "0.65";
    expect(floorThresholds()).toEqual({ minBroad: 3, broadStatureFloor: 0.65 });
  });

  it("is read at CALL time, so a threshold set after import still applies", () => {
    process.env.RADAR_MIN_BROAD_TAGS = "3";
    const v = passesFloors({
      overlap: { tier: "broad", matched: ["a", "b"] },
      stature: 0.95,
    });
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("broad_too_few");
  });

  it("ignores a garbled override rather than turning the floor into NaN", () => {
    process.env.RADAR_MIN_BROAD_TAGS = "not-a-number";
    process.env.RADAR_BROAD_STATURE_FLOOR = "";
    expect(floorThresholds()).toEqual({
      minBroad: MIN_BROAD_TAGS,
      broadStatureFloor: BROAD_STATURE_FLOOR,
    });
  });

  it("takes an explicit thresholds argument over the env", () => {
    process.env.RADAR_MIN_BROAD_TAGS = "9";
    const v = passesFloors(
      { overlap: { tier: "broad", matched: ["a", "b"] }, stature: 0.95 },
      { minBroad: 2, broadStatureFloor: 0.8 }
    );
    expect(v.pass).toBe(true);
  });
});
