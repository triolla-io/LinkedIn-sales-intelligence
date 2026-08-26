import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const companyFindMany = vi.fn();
const profileUpsert = vi.fn();
const profileFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    trackedCompany: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    personProfile: {
      upsert: (...a: unknown[]) => profileUpsert(...a),
      findMany: (...a: unknown[]) => profileFindMany(...a),
    },
    // The rebuild detaches stale subscriptions and marks what they had already produced.
    personAxis: {
      deleteMany: (...a: unknown[]) => personAxisDeleteMany(...a),
      findMany: (...a: unknown[]) => personAxisFindMany(...a),
    },
    axisMatch: {
      findMany: (...a: unknown[]) => axisMatchFindMany(...a),
      updateMany: (...a: unknown[]) => axisMatchUpdateMany(...a),
    },
    radarDraft: {
      findMany: (...a: unknown[]) => draftFindMany(...a),
      updateMany: (...a: unknown[]) => draftUpdateMany(...a),
    },
  },
}));

const personAxisDeleteMany = vi.fn(async (..._a: unknown[]) => ({ count: 0 }));
const personAxisFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const axisMatchFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const axisMatchUpdateMany = vi.fn(async (..._a: unknown[]) => ({ count: 0 }));
const draftFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const draftUpdateMany = vi.fn(async (..._a: unknown[]) => ({ count: 0 }));

const buildPersonProfile = vi.fn();
vi.mock("@/lib/tech-radar/person-profile", () => ({
  buildPersonProfile: (...a: unknown[]) => buildPersonProfile(...a),
}));

const attachAxes = vi.fn();
const ensureCompanyMonitorAxis = vi.fn();
vi.mock("@/lib/tech-radar/axis-store", () => ({
  attachAxes: (...a: unknown[]) => attachAxes(...a),
  ensureCompanyMonitorAxis: (...a: unknown[]) => ensureCompanyMonitorAxis(...a),
}));

/**
 * The pool count the report carries after a rebuild — the number the competitive-set gate
 * has to be judged on, since refusing a merge raises the axis count but only raises the
 * BILL if it raises the count of distinct query strings.
 */
const poolQueryCount = vi.fn();
/**
 * The gate is MOCKED, not exercised. Until 2026-08-26 it was not, so `gateRationales`
 * made a real OpenRouter call on every run of this file — money spent by a test suite
 * with no announcement, and a ~4.4s call against a 5s timeout that made it flaky too.
 * Nothing here is testing the gate's judgement; the subject is what buildProfilesForMarked
 * does with the gate's answer. See tests/unit/tech-radar-rationale-gate.test.ts for the
 * gate itself, and lib/openrouter/client.ts for the guard that now makes this impossible
 * to forget.
 */
const gateRationales = vi.fn();
vi.mock("@/lib/tech-radar/rationale-gate", () => ({
  gateRationales: (...a: unknown[]) => gateRationales(...a),
}));

vi.mock("@/lib/tech-radar/person-scan", () => ({
  poolQueryCount: (...a: unknown[]) => poolQueryCount(...a),
}));

const { buildProfilesForMarked } = await import("@/lib/tech-radar/build-profiles");

const usableProfile = {
  businessLines: [{ name: "Sports content", description: "scores" }],
  products: ["365Scores"], customerSegments: [], techStack: [], digitalInitiatives: [],
  focusAreas: [{ area: "recommendations", why: "w" }],
  searchQueries: ["recommendation engine research"], sources: [],
};

const contact = (over: Record<string, unknown> = {}) => ({
  id: "c1", fullName: "Roy Hayumi", currentTitle: "Co-Founder & VP-R&D", headline: null,
  currentCompany: "365Scores", companyId: null, personProfile: null, ...over,
});
const employer = (over: Record<string, unknown> = {}) => ({
  id: "tc1", name: "365Scores", aliases: [], companyId: null, profile: usableProfile, status: "ACTIVE", ...over,
});

beforeEach(() => {
  for (const m of [contactFindMany, companyFindMany, profileUpsert, profileFindMany, buildPersonProfile, attachAxes, ensureCompanyMonitorAxis, poolQueryCount, gateRationales]) m.mockReset();
  // Default: the gate keeps what it was given. A test that cares about a rejection says so.
  gateRationales.mockImplementation(async (_lens: string, axes: unknown[]) => ({
    kept: axes,
    rejected: [],
    judged: true,
    deterministic: {},
  }));
  // The invariant read-back: verified against the DB, not against the model's response.
  profileFindMany.mockResolvedValue([]);
  companyFindMany.mockResolvedValue([employer()]);
  profileUpsert.mockResolvedValue({ id: "pp1" });
  buildPersonProfile.mockResolvedValue({
    roleLens: "בונה את מנוע ההמלצות",
    // The declared two sides of the crossing. The gate is mocked here, so these are not
    // what keeps the axis alive — they are what a real proposal looks like now, and a
    // fixture that lies about the shape teaches the next reader the wrong thing.
    axes: [{
      label: "קונסולידציה של מסדי וקטורים", key: "k", searchQueries: ["q"],
      rationale: "כי הוא בנה את זה",
      stage: "decision",
      personDecision: "מחזיק את החלטת מנוע ההמלצות",
      companyFact: "לקוחות פרטיים שצורכים תוצאות ספורט",
    }],
  });
  // refused/mergeRefused: the competitive-set gate's half of the outcome. An axis the gate
  // refused is not a loss — the person got their OWN axis — so it is counted apart from
  // `skipped` and reported with the axis it would have joined.
  attachAxes.mockResolvedValue({ attached: 1, created: 1, merged: 0, refused: 0, skipped: [], mergeRefused: [] });
  ensureCompanyMonitorAxis.mockResolvedValue("ax-mon");
  poolQueryCount.mockResolvedValue({ axes: 12, uniqueQueries: 34 });
});

describe("buildProfilesForMarked", () => {
  it("only considers marked contacts of that owner", async () => {
    contactFindMany.mockResolvedValue([]);
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(contactFindMany.mock.calls[0][0].where).toEqual({ ownerId: "u1", removedAt: null, radarInclude: true });
  });

  it("builds a profile and attaches its axes", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out).toMatchObject({ considered: 1, built: 1, axesCreated: 1 });
    expect(attachAxes.mock.calls[0][0].proposals[0].rationale).toBe("כי הוא בנה את זה");
    expect(ensureCompanyMonitorAxis).toHaveBeenCalled();
  });

  /**
   * The employer profile is context for "what does this person own?". With only a job
   * title the model produces axes indistinguishable from every other holder of that
   * title — the company-level failure one level up. Better to skip and say so.
   */
  it("skips a person whose employer was never researched, with the reason", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    companyFindMany.mockResolvedValue([employer({ profile: null, status: "PENDING_RESEARCH" })]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.built).toBe(0);
    expect(out.skipped).toEqual([{ contactId: "c1", name: "Roy Hayumi", reason: "employer_not_researched" }]);
    expect(buildPersonProfile).not.toHaveBeenCalled();
  });

  /** The Triolla case: research ran and failed. A different reason, a different fix. */
  it("distinguishes a failed employer research from one never attempted", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    companyFindMany.mockResolvedValue([employer({ profile: null, status: "RESEARCH_FAILED" })]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.skipped[0].reason).toBe("employer_research_failed");
  });

  it("skips, rather than silently dropping, a person with no tracked employer", async () => {
    contactFindMany.mockResolvedValue([contact({ currentCompany: "Nowhere Ltd" })]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.skipped[0].reason).toBe("no_tracked_employer");
  });

  it("matches an employer by alias as well as by name", async () => {
    contactFindMany.mockResolvedValue([contact({ currentCompany: "365 Scores Ltd" })]);
    companyFindMany.mockResolvedValue([employer({ aliases: ["365 Scores Ltd"] })]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.built).toBe(1);
  });

  it("leaves a fresh profile alone", async () => {
    contactFindMany.mockResolvedValue([
      contact({ personProfile: { id: "pp1", refreshedAt: new Date() } }),
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.built).toBe(0);
    expect(buildPersonProfile).not.toHaveBeenCalled();
  });

  it("rebuilds a stale profile and counts it as refreshed", async () => {
    contactFindMany.mockResolvedValue([
      contact({ personProfile: { id: "pp1", refreshedAt: new Date("2020-01-01") } }),
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.refreshed).toBe(1);
  });

  /** personalNotes is learned from feedback; a rebuild must not erase it. */
  it("never overwrites learned personal notes", async () => {
    contactFindMany.mockResolvedValue([
      contact({ personProfile: { id: "pp1", refreshedAt: new Date("2020-01-01") } }),
    ]);
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(Object.keys(profileUpsert.mock.calls[0][0].update)).not.toContain("personalNotes");
  });

  it("keeps going after one person fails", async () => {
    contactFindMany.mockResolvedValue([contact({ id: "c1" }), contact({ id: "c2" })]);
    buildPersonProfile.mockResolvedValueOnce(null);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.built).toBe(1);
    expect(out.skipped[0].reason).toBe("profile_call_failed");
  });

  it("surfaces an axis the gate refused", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    attachAxes.mockResolvedValue({ attached: 0, created: 0, merged: 0, refused: 0, skipped: [{ label: "תחום", reason: "empty_key" }], mergeRefused: [] });
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.skipped[0].reason).toMatch(/axis_empty_key: תחום/);
  });

  /**
   * A merge decided on the label alone IS the 2026-08-26 bug: Elinor (Bank Leumi) was
   * folded into Gil Tamir's Phoenix axis and inherited its insurance queries. The gate
   * cannot make that call without knowing whose competitors are whose.
   */
  it("hands attachAxes the employer's competitive set", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    companyFindMany.mockResolvedValue([
      employer({ aliases: ["365"], profile: { ...usableProfile, namedCompetitors: ["Sofascore / סופהסקור"] } }),
    ]);
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(attachAxes.mock.calls[0][0].employer).toEqual({
      employerId: "tc1",
      names: ["365Scores", "365"],
      namedCompetitors: ["Sofascore / סופהסקור"],
    });
  });

  it("surfaces a refused merge with the person, the label and the axis it would have joined", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    attachAxes.mockResolvedValue({
      attached: 1, created: 1, merged: 0, refused: 1, skipped: [],
      mergeRefused: [{
        label: "תחרות מוצרית מול הפועלים ודיסקונט",
        reason: "merge_refused[תחרות דיגיטלית מול הראל ומגדל · The Phoenix Holdings]",
      }],
    });
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.axesRefused).toBe(1);
    expect(out.skipped[0].name).toBe("Roy Hayumi");
    expect(out.skipped[0].reason).toContain(
      "axis_merge_refused[תחרות דיגיטלית מול הראל ומגדל · The Phoenix Holdings]: תחרות מוצרית מול הפועלים ודיסקונט"
    );
    // The bill, not just the axis count: refusing a merge only costs money if it raises
    // the number of unique queries the next scan runs.
    expect(out.pool).toEqual({ axes: 12, uniqueQueries: 34 });
  });
});

describe("the Hebrew-query invariant", () => {
  it("reports Hebrew queries per person, read back from the database", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    profileFindMany.mockResolvedValue([
      {
        contact: { fullName: "Roy Hayumi" },
        axes: [{ agenda: true, axis: { searchQueries: ["מרווחי זיקוק", "refining outlook"] } }],
      },
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.hebrewQueriesByPerson).toEqual([{ name: "Roy Hayumi", hebrew: 1, agenda: 1 }]);
    expect(out.noHebrewQuery).toEqual([]);
  });

  /** The exact state after the 23.8 scan: 54 queries, zero Israeli sources. */
  it("names anyone left with no Hebrew query at all", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    profileFindMany.mockResolvedValue([
      { contact: { fullName: "Ofir Alon" }, axes: [{ agenda: true, axis: { searchQueries: ["refining margins"] } }] },
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.noHebrewQuery).toEqual(["Ofir Alon"]);
  });
})
