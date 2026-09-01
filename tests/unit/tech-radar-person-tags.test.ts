import { describe, expect, it } from "vitest";
import { personTags, type PersonTagLink } from "@/lib/tech-radar/person-tags";

/**
 * Pazit Garfinkel, Head of Retail Banking at Bank Hapoalim — the person every case in
 * this file is drawn from. Her prod row on 2026-08-31 is what the v3 tag layer exists
 * for: five axes that were her employer in five costumes, and no entity tag anywhere,
 * so "One Zero" in a headline reached nobody.
 */
const PAZIT = { id: "pp_pazit" };

/** A link with the fields that decide its tier, and nothing else. */
function link(over: Partial<PersonTagLink> & { tag: string }): PersonTagLink {
  return {
    personProfileId: PAZIT.id,
    kind: "ROLE_COMPANY",
    source: "ROLE_COMPANY",
    mutedAt: null,
    ...over,
  };
}

describe("personTags — the tiers", () => {
  it("puts a person's own ROLE_COMPANY subject in the focused tier", () => {
    const out = personTags(PAZIT, [link({ tag: "אשראי-צרכני" })]);
    expect(out.focused).toEqual(["אשראי-צרכני"]);
    expect(out.broad).toEqual([]);
  });

  it("puts the shared INDUSTRY net in the broad tier", () => {
    const out = personTags(PAZIT, [
      link({ tag: "רגולציה-ישראל", kind: "INDUSTRY", source: "INDUSTRY" }),
    ]);
    expect(out.broad).toEqual(["רגולציה-ישראל"]);
    expect(out.focused).toEqual([]);
  });

  it("treats the v3 INDUSTRY_TAG kind as broad too, so the rename does not change the tier", () => {
    const out = personTags(PAZIT, [
      link({ tag: "תשלומים", kind: "INDUSTRY_TAG", source: "INDUSTRY" }),
    ]);
    expect(out.broad).toEqual(["תשלומים"]);
  });

  it("makes a MANUAL link focused regardless of kind — ידנית = העלאה", () => {
    // The same INDUSTRY axis that lands in `broad` above. A human attaching it by hand
    // is the correction, and a correction that arrived as a broad tag would need two
    // more of them plus stature 0.8 to survive the floors, i.e. it would not stick.
    const out = personTags(PAZIT, [
      link({ tag: "רגולציה-ישראל", kind: "INDUSTRY", source: "MANUAL" }),
    ]);
    expect(out.focused).toEqual(["רגולציה-ישראל"]);
    expect(out.broad).toEqual([]);
  });

  it("keeps a tag out of broad when it is already focused — a duplicate would inflate the ≥2 broad count", () => {
    const out = personTags(PAZIT, [
      link({ tag: "משכנתאות" }),
      link({ tag: "משכנתאות", kind: "INDUSTRY", source: "INDUSTRY" }),
    ]);
    expect(out.focused).toEqual(["משכנתאות"]);
    expect(out.broad).toEqual([]);
  });
});

describe("personTags — muting", () => {
  it("a muted link contributes nothing to any tier", () => {
    const out = personTags(PAZIT, [
      link({ tag: "שוקי-הון", mutedAt: new Date("2026-08-30T00:00:00Z") }),
      link({ tag: "תשלומים", kind: "INDUSTRY", source: "INDUSTRY", mutedAt: "2026-08-30" }),
      link({
        tag: "One Zero",
        kind: "PERSON_ENTITY",
        source: "PERSON_ENTITY",
        mutedAt: new Date("2026-08-30T00:00:00Z"),
        evidence: { aliases: ["וואן זירו"] },
      }),
    ]);
    expect(out).toEqual({ focused: [], broad: [], entities: [] });
  });

  it("mutes a MANUAL link too — השתקה is the other side of the same handle", () => {
    const out = personTags(PAZIT, [
      link({ tag: "שוקי-הון", source: "MANUAL", mutedAt: new Date("2026-08-30T00:00:00Z") }),
    ]);
    expect(out.focused).toEqual([]);
  });
});

describe("personTags — entities", () => {
  it("returns an entity's aliases in BOTH scripts", () => {
    // Israeli press writes "וואן זירו", the company writes "One Zero". A match on one
    // spelling only is a recall hole with no symptom.
    const out = personTags(PAZIT, [
      link({
        tag: "One Zero",
        kind: "PERSON_ENTITY",
        source: "PERSON_ENTITY",
        evidence: { aliases: ["וואן זירו", "OneZero", "וואן-זירו"] },
      }),
    ]);
    expect(out.entities).toEqual([
      { name: "One Zero", aliases: ["וואן זירו", "OneZero", "וואן-זירו"] },
    ]);
  });

  it("keeps every one of her four watched entities, deduped by name", () => {
    const out = personTags(PAZIT, [
      link({ tag: "One Zero", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: { aliases: ["וואן זירו"] } }),
      link({ tag: "Pepper", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: { aliases: ["פפר"] } }),
      link({ tag: "Payoneer", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: { aliases: ["פייונר"] } }),
      link({ tag: "Wise", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: { aliases: ["וייז"] } }),
      link({ tag: "one zero", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: { aliases: ["ONE ZERO"] } }),
    ]);
    expect(out.entities.map((e) => e.name)).toEqual(["One Zero", "Pepper", "Payoneer", "Wise"]);
  });

  it("survives evidence that is null, a string, or has no aliases — a legacy row is not a crash", () => {
    const out = personTags(PAZIT, [
      link({ tag: "Pepper", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: null }),
      link({ tag: "Wise", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: "פפר" }),
      link({ tag: "Payoneer", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", evidence: { aliases: "פייונר" } }),
    ]);
    expect(out.entities).toEqual([
      { name: "Pepper", aliases: [] },
      { name: "Wise", aliases: [] },
      { name: "Payoneer", aliases: [] },
    ]);
  });

  it("drops an alias that only restates the name", () => {
    const out = personTags(PAZIT, [
      link({
        tag: "One Zero",
        kind: "PERSON_ENTITY",
        source: "PERSON_ENTITY",
        evidence: { aliases: ["ONE ZERO", "וואן זירו"] },
      }),
    ]);
    expect(out.entities[0].aliases).toEqual(["וואן זירו"]);
  });

  it("a MANUAL entity tag is still an entity — matched by name, and focused as well", () => {
    const out = personTags(PAZIT, [
      link({ tag: "Pepper", kind: "PERSON_ENTITY", source: "MANUAL", evidence: { aliases: ["פפר"] } }),
    ]);
    expect(out.entities).toEqual([{ name: "Pepper", aliases: ["פפר"] }]);
    expect(out.focused).toEqual(["Pepper"]);
  });
});

describe("personTags — isolation", () => {
  it("nothing from another person's axes leaks in", () => {
    // Elinor Levinson Gafni (Bank Leumi) was subscribed to insurance axes in prod. A
    // tag layer that read the org's links instead of this person's would hand Pazit
    // Elinor's rivals, which is that failure with a new mechanism.
    const out = personTags(PAZIT, [
      link({ tag: "אשראי-צרכני" }),
      link({ tag: "ביטוח-בריאות", personProfileId: "pp_elinor" }),
      link({ tag: "הראל", kind: "PERSON_ENTITY", source: "PERSON_ENTITY", personProfileId: "pp_elinor" }),
      link({ tag: "תשלומים", kind: "INDUSTRY", source: "INDUSTRY", personProfileId: "pp_elinor" }),
    ]);
    expect(out).toEqual({ focused: ["אשראי-צרכני"], broad: [], entities: [] });
  });

  it("drops a blank or whitespace-only tag rather than emitting an empty string", () => {
    const out = personTags(PAZIT, [link({ tag: "   " }), link({ tag: "" }), link({ tag: "משכנתאות" })]);
    expect(out.focused).toEqual(["משכנתאות"]);
  });

  it("returns three empty lists for a person with no links", () => {
    expect(personTags(PAZIT, [])).toEqual({ focused: [], broad: [], entities: [] });
  });
});
