import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Task 9 — the wiring. Tasks 4-8 built the person model's new inputs (career, person web
 * research, business lines), its new outputs (audience, scope, entityTags) and the truth
 * gates over them; none of it took effect until buildProfilesForMarked actually passed the
 * inputs in and persisted the outputs. This file pins the four seams:
 *
 *   1. the new inputs reach buildPersonProfile,
 *   2. audience/scope are persisted on both the create and the update branch,
 *   3. entity tags become PERSON_ENTITY axes — minus the ones the truth gate drops,
 *   4. a force rebuild NEVER deletes a MANUAL PersonAxis link.
 *
 * (4) is the load-bearing one: Task 10 ships an add-tag control whose whole contract is
 * `source: "MANUAL"`, and a rebuild that erased those rows would make that control a lie.
 *
 * Everything external is mocked — prisma, buildPersonProfile (a real call is a paid Sonnet
 * call), the rationale gate (a real call is a paid judge call), the axis store. The truth
 * rules (invalidEntityTags) and careerSummary are the REAL modules: they are pure, and the
 * subject here is what build-profiles does with their answers.
 */

const contactFindMany = vi.fn();
const companyFindMany = vi.fn();
const profileUpsert = vi.fn();
const profileFindMany = vi.fn();
const personAxisDeleteMany = vi.fn(async (..._a: unknown[]) => ({ count: 0 }));
const personAxisFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const axisMatchFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const axisMatchUpdateMany = vi.fn(async (..._a: unknown[]) => ({ count: 0 }));
const draftFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const draftUpdateMany = vi.fn(async (..._a: unknown[]) => ({ count: 0 }));
// ensureEntityAxes' own writes. Both are upserts on purpose — see the describe block below.
const axisUpsert = vi.fn(async (..._a: unknown[]) => ({ id: "ax-entity" }));
const personAxisUpsert = vi.fn(async (..._a: unknown[]) => ({ id: "pa1" }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    trackedCompany: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    personProfile: {
      upsert: (...a: unknown[]) => profileUpsert(...a),
      findMany: (...a: unknown[]) => profileFindMany(...a),
    },
    personAxis: {
      deleteMany: (...a: unknown[]) => personAxisDeleteMany(...a),
      findMany: (...a: unknown[]) => personAxisFindMany(...a),
      upsert: (...a: unknown[]) => personAxisUpsert(...a),
    },
    radarAxis: { upsert: (...a: unknown[]) => axisUpsert(...a) },
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

const buildPersonProfile = vi.fn();
vi.mock("@/lib/tech-radar/person-profile", () => ({
  buildPersonProfile: (...a: unknown[]) => buildPersonProfile(...a),
  AXIS_STAGES: ["decision", "competitor", "stop_and_read", "adopt"] as const,
}));

const attachAxes = vi.fn();
const ensureCompanyMonitorAxis = vi.fn();
const ensureIndustryAxis = vi.fn();
const ensureEntityAxes = vi.fn();
vi.mock("@/lib/tech-radar/axis-store", () => ({
  attachAxes: (...a: unknown[]) => attachAxes(...a),
  ensureCompanyMonitorAxis: (...a: unknown[]) => ensureCompanyMonitorAxis(...a),
  ensureIndustryAxis: (...a: unknown[]) => ensureIndustryAxis(...a),
  ensureEntityAxes: (...a: unknown[]) => ensureEntityAxes(...a),
}));

const gateRationales = vi.fn();
vi.mock("@/lib/tech-radar/rationale-gate", () => ({
  gateRationales: (...a: unknown[]) => gateRationales(...a),
}));

const poolQueryCount = vi.fn();
vi.mock("@/lib/tech-radar/person-scan", () => ({
  poolQueryCount: (...a: unknown[]) => poolQueryCount(...a),
  MAX_QUERIES_PER_AXIS: 3,
}));

const { buildProfilesForMarked } = await import("@/lib/tech-radar/build-profiles");
const { careerSummary } = await import("@/lib/tech-radar/career");
/**
 * The REAL axis store, reached past the module mock above — its prisma import still
 * resolves to the mock, so nothing touches a database. Mocking it for build-profiles and
 * exercising it for real in one file is deliberate: the wiring and the function it wires
 * to are one contract, and a mocked `ensureEntityAxes` cannot show that the row it writes
 * carries `source: "PERSON_ENTITY"` and no search queries.
 */
const { ensureEntityAxes: realEnsureEntityAxes, entityAxisKey } = await vi.importActual<
  typeof import("@/lib/tech-radar/axis-store")
>("@/lib/tech-radar/axis-store");
const { normalizeAxisKey } = await import("@/lib/tech-radar/axis");

/** Bank Hapoalim, in the shape research v2 writes it: business lines with `forWhom`,
 *  a competitor gazetteer the entity-tag gate checks against, and dated moves. */
const usableProfile = {
  businessLines: [
    { name: "Retail banking", description: "current accounts and cards", forWhom: "B2C: households in Israel" },
    { name: "Trade finance", description: "importer credit", forWhom: "B2B: mid-market importers" },
  ],
  products: ["Poalim Wonder", "bit"],
  namedCompetitors: ["One Zero / וואן זירו", "Bank Leumi / לאומי"],
  customerSegments: [], techStack: [], digitalInitiatives: [],
  focusAreas: [{ area: "digital retail", why: "w" }],
  searchQueries: ["בנק הפועלים דיגיטל"], sources: [],
  recentMoves: [{ fact: "השיקה את פרויקט אשראי מהיר", dateIso: "2026-06-01" }],
  industry: { canonical: "בנקאות ישראל", queries: ["בנקאות ישראל רגולציה"] },
};

const contact = (over: Record<string, unknown> = {}) => ({
  id: "c1", fullName: "Pazit Garfinkel", currentTitle: "Head of Retail Banking", headline: null,
  currentCompany: "Bank Hapoalim", companyId: null, personProfile: null,
  about: "מנהלת את הבנקאות הקמעונאית", experience: null, skills: null, education: null,
  hebrewFirstName: null, profileScrapedAt: null, ...over,
});
const employer = (over: Record<string, unknown> = {}) => ({
  id: "tc1", name: "Bank Hapoalim", aliases: ["בנק הפועלים"], companyId: null,
  profile: usableProfile, status: "ACTIVE", ...over,
});

const draft = (over: Record<string, unknown> = {}) => ({
  reasoning: "שלב א ...",
  roleLens: "מנהלת את הבנקאות הקמעונאית",
  audience: { type: ["B2C"], who: "משקי בית ולקוחות פרטיים", geography: "ישראל" },
  scope: { owns: ["בנקאות קמעונאית"], notOwns: ["מסחר בינלאומי"] },
  entityTags: [{ name: "One Zero", aliases: ["וואן זירו"], kind: "competitor" }],
  domains: [{ domain: "בנקאות קמעונאית", kind: "found", source: "title", evidence: "Head of Retail Banking" }],
  axes: [{
    label: "חוויית הלקוח בריטייל", key: "k", searchQueries: ["q"],
    rationale: "היא חתומה על החוויה",
    stage: "decision",
    domain: "בנקאות קמעונאית",
    layerEvidence: { layer: 2, quote: "משקי בית" },
    personDecision: "חתומה על חוויית הלקוח",
    companyFact: "לקוחות פרטיים",
    agenda: true,
  }],
  ...over,
});

beforeEach(() => {
  for (const m of [
    contactFindMany, companyFindMany, profileUpsert, profileFindMany, buildPersonProfile,
    attachAxes, ensureCompanyMonitorAxis, ensureIndustryAxis, ensureEntityAxes, poolQueryCount,
    gateRationales, personAxisDeleteMany, axisUpsert, personAxisUpsert,
  ]) m.mockReset();
  gateRationales.mockImplementation(async (_lens: string, axes: unknown[]) => ({
    kept: axes, rejected: [], judged: true, deterministic: {},
  }));
  contactFindMany.mockResolvedValue([contact()]);
  companyFindMany.mockResolvedValue([employer()]);
  profileFindMany.mockResolvedValue([]);
  profileUpsert.mockResolvedValue({ id: "pp1" });
  personAxisDeleteMany.mockResolvedValue({ count: 0 });
  buildPersonProfile.mockResolvedValue(draft());
  attachAxes.mockResolvedValue({ attached: 1, created: 1, merged: 0, refused: 0, skipped: [], mergeRefused: [] });
  ensureCompanyMonitorAxis.mockResolvedValue("ax-mon");
  ensureIndustryAxis.mockResolvedValue("ax-industry");
  ensureEntityAxes.mockResolvedValue(["ax-entity"]);
  poolQueryCount.mockResolvedValue({ axes: 12, uniqueQueries: 34 });
  axisUpsert.mockResolvedValue({ id: "ax-entity" });
  personAxisUpsert.mockResolvedValue({ id: "pa1" });
});

describe("buildProfilesForMarked feeds the v2 inputs into the build call", () => {
  it("passes skills, education, career and businessLines", async () => {
    const experience = [
      { title: "Head of Retail Banking", company: "Bank Hapoalim", dateRange: "Jan 2020 - Present" },
      { title: "Branch Manager", company: "Bank Hapoalim", dateRange: "2014 - 2020" },
    ];
    contactFindMany.mockResolvedValue([
      contact({ experience, skills: ["Retail Banking", "Trade Finance"], education: [{ school: "TAU", degree: "MBA", field: "Finance" }] }),
    ]);
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });

    expect(buildPersonProfile.mock.calls[0][0]).toMatchObject({
      skills: ["Retail Banking", "Trade Finance"],
      education: [{ school: "TAU", degree: "MBA", field: "Finance" }],
      // Computed in code, never guessed by the model — asserted against the real helper so
      // the test pins the wiring rather than the current year.
      career: careerSummary(experience),
      businessLines: usableProfile.businessLines,
    });
  });

  it("selects the columns those inputs come from", async () => {
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    const select = contactFindMany.mock.calls[0][0].select;
    expect(select).toMatchObject({ skills: true, education: true, hebrewFirstName: true });
  });

  /** The prepare flow researches the person and hands the findings in — the map is a
   *  CACHE, and a hit must not be re-researched. */
  it("prefers the caller's pre-fetched research over researching again", async () => {
    const research = { findings: [{ title: "ראיון", url: "https://x", snippet: "s", pageText: null }] };
    const researcher = vi.fn();
    await buildProfilesForMarked({
      orgId: "org1", ownerId: "u1",
      personResearchByContact: new Map([["c1", research]]),
      researcher,
    });
    expect(buildPersonProfile.mock.calls[0][0].personResearch).toBe(research);
    expect(researcher).not.toHaveBeenCalled();
  });

  /**
   * The inverse of the old contract, and the whole point of the 2026-09-01 fix. This used
   * to assert `personResearch` was NULL when the caller passed no map — which is exactly
   * what all three real callers do, so every person built by every real path was modelled
   * from the job title crossed with the employer and nothing else. A person model whose
   * only inputs are the title and the company cannot be personal, and the axes it produced
   * were the proof: two axes for a Head of Retail Banking, both derivable from the chair.
   */
  it("researches a contact the caller did not pre-fetch, instead of building blind", async () => {
    const found = { findings: [{ title: "תחומי אחריות", url: "https://y", snippet: "s", pageText: null }] };
    const researcher = vi.fn().mockResolvedValue(found);
    const report = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1", researcher });

    expect(researcher).toHaveBeenCalledTimes(1);
    expect(researcher.mock.calls[0][0]).toMatchObject({ companyName: expect.any(String) });
    expect(buildPersonProfile.mock.calls[0][0].personResearch).toBe(found);
    expect(report.noResearch).toEqual([]);
  });

  /** Zero findings is not a quiet outcome: it means this person was modelled on their
   *  title alone, and the report has to say whose model that is. */
  it("names anyone built on zero findings, and never throws on a research failure", async () => {
    const report = await buildProfilesForMarked({
      orgId: "org1", ownerId: "u1",
      researcher: vi.fn().mockRejectedValue(new Error("provider down")),
    });
    expect(report.noResearch.length).toBe(1);
    expect(report.researchByPerson[0]).toMatchObject({ findings: 0, paidQueries: 0 });
  });

  /** The fabricated-date check fails OPEN with no moves in hand, so a gate that never
   *  receives them can never catch the invented `dateIso: "2024-01-01"`. */
  it("hands the employer's dated moves to the rationale gate", async () => {
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(gateRationales.mock.calls[0][2].recentMoves).toEqual(usableProfile.recentMoves);
  });
});

describe("buildProfilesForMarked persists audience and scope", () => {
  it("writes them on the create branch and the update branch", async () => {
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    const args = profileUpsert.mock.calls[0][0];
    expect(args.create).toMatchObject({
      audience: { type: ["B2C"], who: "משקי בית ולקוחות פרטיים", geography: "ישראל" },
      scope: { owns: ["בנקאות קמעונאית"], notOwns: ["מסחר בינלאומי"] },
    });
    expect(args.update).toMatchObject({
      audience: { type: ["B2C"], who: "משקי בית ולקוחות פרטיים", geography: "ישראל" },
      scope: { owns: ["בנקאות קמעונאית"], notOwns: ["מסחר בינלאומי"] },
    });
  });
});

describe("buildProfilesForMarked turns entity tags into axes, minus the invented ones", () => {
  it("keeps a researched competitor and drops one the research never named", async () => {
    buildPersonProfile.mockResolvedValue(draft({
      entityTags: [
        { name: "One Zero", aliases: ["וואן זירו"], kind: "competitor" },
        // The live failure: an invented bank whose name went out in a real search.
        { name: "בנק בינלאומי ראשון", aliases: [], kind: "competitor" },
        // The employer's OWN product — kept, and the reason products are validated
        // against the employer rather than against the gazetteer.
        { name: "Poalim Wonder", aliases: [], kind: "product" },
      ],
    }));
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });

    expect(ensureEntityAxes).toHaveBeenCalledTimes(1);
    const passed = ensureEntityAxes.mock.calls[0][0];
    expect(passed).toMatchObject({ orgId: "org1", personProfileId: "pp1" });
    expect(passed.tags.map((t: { name: string }) => t.name)).toEqual(["One Zero", "Poalim Wonder"]);
    expect(out.entityTagsDropped).toEqual(["בנק בינלאומי ראשון"]);
  });

  it("does not call the axis store at all when every tag was invented", async () => {
    buildPersonProfile.mockResolvedValue(draft({
      entityTags: [{ name: "בנק בינלאומי ראשון", aliases: [], kind: "competitor" }],
    }));
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(ensureEntityAxes).not.toHaveBeenCalled();
    expect(out.entityTagsDropped).toEqual(["בנק בינלאומי ראשון"]);
  });
});

describe("a force rebuild never erases a human's correction", () => {
  /**
   * THE line. `source: { not: "INDUSTRY" }` swept every non-industry link away on each
   * force rebuild, MANUAL rows included — so the person page's add-tag control would have
   * held for exactly one rebuild. INDUSTRY is excluded because it is a shared net that
   * ensureIndustryAxis has already re-created above; MANUAL because it is a human's
   * correction, which no automated rebuild gets to overrule.
   */
  it("detaches LLM-born links but excludes both INDUSTRY and MANUAL", async () => {
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1", force: true });
    expect(personAxisDeleteMany).toHaveBeenCalledTimes(1);
    expect(personAxisDeleteMany.mock.calls[0][0]).toEqual({
      where: { personProfileId: "pp1", mutedAt: null, source: { notIn: ["INDUSTRY", "MANUAL"] } },
    });
  });

  it("does not detach anything without force", async () => {
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(personAxisDeleteMany).not.toHaveBeenCalled();
  });
});

describe("ensureEntityAxes", () => {
  const tag = (over: Record<string, unknown> = {}) =>
    ({ name: "One Zero", aliases: ["וואן זירו"], kind: "competitor", ...over }) as {
      name: string; aliases: string[]; kind: "competitor" | "product" | "project" | "regulator";
    };

  it("upserts one namespaced axis per tag and subscribes the person", async () => {
    await realEnsureEntityAxes({ orgId: "org1", personProfileId: "pp1", tags: [tag()] });

    expect(axisUpsert.mock.calls[0][0]).toMatchObject({
      where: { orgId_key: { orgId: "org1", key: `entity:pp1:${normalizeAxisKey("One Zero")}` } },
      create: { orgId: "org1", label: "One Zero", kind: "PERSON_ENTITY", searchQueries: [] },
      update: {},
    });
    expect(personAxisUpsert.mock.calls[0][0]).toMatchObject({
      where: { personProfileId_axisId: { personProfileId: "pp1", axisId: "ax-entity" } },
      create: {
        personProfileId: "pp1", axisId: "ax-entity", source: "PERSON_ENTITY", agenda: false,
        evidence: { aliases: ["וואן זירו"], tagKind: "competitor" },
      },
      // A re-run must neither double-subscribe nor overwrite a weight the learning loop moved.
      update: {},
    });
  });

  /**
   * The key is per-person on purpose: two people at the same bank watching One Zero watch
   * it for different reasons, and a shared row would hand one of them the other's aliases.
   */
  it("namespaces the key per person", async () => {
    expect(entityAxisKey("pp1", "One Zero")).not.toBe(entityAxisKey("pp2", "One Zero"));
    expect(entityAxisKey("pp1", "one   zero")).toBe(entityAxisKey("pp1", "One Zero"));
  });

  /** An all-filler name normalises to nothing, and every such tag would collide onto one
   *  degenerate axis — the same guard ensureIndustryAxis makes for "industry:". */
  it("refuses a tag whose normalized name is empty", async () => {
    const out = await realEnsureEntityAxes({ orgId: "org1", personProfileId: "pp1", tags: [tag({ name: "  של  " })] });
    expect(axisUpsert).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("carries no search queries — matching is by name and aliases in code", async () => {
    await realEnsureEntityAxes({ orgId: "org1", personProfileId: "pp1", tags: [tag()] });
    expect(axisUpsert.mock.calls[0][0].create.searchQueries).toEqual([]);
  });
});
