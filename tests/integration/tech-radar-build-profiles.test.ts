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
  // The real list, not a stand-in: profile-quality reads it to tally the four stages, and
  // a short mock list would silently drop a stage from the report this file asserts on.
  AXIS_STAGES: ["decision", "competitor", "stop_and_read", "adopt"] as const,
}));

const attachAxes = vi.fn();
const ensureCompanyMonitorAxis = vi.fn();
const ensureIndustryAxis = vi.fn();
vi.mock("@/lib/tech-radar/axis-store", () => ({
  attachAxes: (...a: unknown[]) => attachAxes(...a),
  ensureCompanyMonitorAxis: (...a: unknown[]) => ensureCompanyMonitorAxis(...a),
  ensureIndustryAxis: (...a: unknown[]) => ensureIndustryAxis(...a),
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
  // The SAME effective per-axis cap the real pool fetches under — a report field that
  // mirrors this must be tested against the real value, not an arbitrary mock number.
  MAX_QUERIES_PER_AXIS: 3,
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
  for (const m of [contactFindMany, companyFindMany, profileUpsert, profileFindMany, buildPersonProfile, attachAxes, ensureCompanyMonitorAxis, ensureIndustryAxis, poolQueryCount, gateRationales]) m.mockReset();
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
    // Layer 4's fields of work — Task 9's `domains`, persisted verbatim onto
    // PersonProfile.domains and looked up by build-profiles.ts to tag each axis's
    // evidence with domainKind/domainSource (Task 10).
    domains: [
      { domain: "מנוע המלצות", kind: "found", source: "title", evidence: "VP-R&D" },
    ],
    // The declared two sides of the crossing. The gate is mocked here, so these are not
    // what keeps the axis alive — they are what a real proposal looks like now, and a
    // fixture that lies about the shape teaches the next reader the wrong thing.
    axes: [{
      label: "קונסולידציה של מסדי וקטורים", key: "k", searchQueries: ["q"],
      rationale: "כי הוא בנה את זה",
      stage: "decision",
      domain: "מנוע המלצות",
      layerEvidence: { layer: 2, quote: "מוכר תוצאות ספורט ללקוחות פרטיים" },
      personDecision: "מחזיק את החלטת מנוע ההמלצות",
      companyFact: "לקוחות פרטיים שצורכים תוצאות ספורט",
    }],
  });
  // refused/mergeRefused: the competitive-set gate's half of the outcome. An axis the gate
  // refused is not a loss — the person got their OWN axis — so it is counted apart from
  // `skipped` and reported with the axis it would have joined.
  attachAxes.mockResolvedValue({ attached: 1, created: 1, merged: 0, refused: 0, skipped: [], mergeRefused: [] });
  ensureCompanyMonitorAxis.mockResolvedValue("ax-mon");
  ensureIndustryAxis.mockResolvedValue("ax-industry");
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

  /**
   * SCRAPE_PROFILE either never ran for this contact or landed on an old extension build
   * that captured neither headline nor about. Without any of the three, the model has
   * nothing to read a role out of — modelling anyway produces a profile that fits any
   * blank contact equally well, which is worse than admitting there's nothing to model.
   */
  it("skips a contact with no currentTitle, headline or about — no LLM call", async () => {
    contactFindMany.mockResolvedValue([
      contact({ currentTitle: null, headline: null, about: null }),
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.built).toBe(0);
    expect(out.skipped).toEqual([{ contactId: "c1", name: "Roy Hayumi", reason: "person_data_missing" }]);
    expect(buildPersonProfile).not.toHaveBeenCalled();
  });

  it("threads about and experience through to buildPersonProfile (Task 9 reads them)", async () => {
    contactFindMany.mockResolvedValue([
      contact({ about: "Builds recommendation engines.", experience: [{ title: "VP R&D", company: "365Scores", dateRange: "2020-present" }] }),
    ]);
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(buildPersonProfile.mock.calls[0][0]).toMatchObject({
      about: "Builds recommendation engines.",
      experience: [{ title: "VP R&D", company: "365Scores", dateRange: "2020-present" }],
    });
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

/**
 * The rationale-gate exemption, PINNED. gateRationales judges draft.axes (the
 * ROLE_COMPANY proposals) only — it never sees an INDUSTRY proposal, because there is no
 * such thing: the industry net is built from the employer's own research, not from the
 * person's draft, and ensureIndustryAxis is called independently of what the gate decided.
 *
 * This matters because an INDUSTRY axis carries no personDecision and would die on
 * no_person_side if it were ever routed through gateRationales — so the net has to
 * survive even a person whose every role axis was judged too generic to keep. Before this
 * task, "all_rationales_generic" meant `continue` before the person even got a
 * PersonProfile row, which would have made ensureIndustryAxis unreachable for exactly the
 * people this exemption exists for.
 */
/**
 * 2026-08-26 final review, Finding 2. Task 8 correctly moved the `gate.kept.length ===
 * 0` early exit to AFTER personProfile.upsert, so the INDUSTRY net could still reach a
 * wholesale-rejected person. But the upsert's `update` branch unconditionally stamped
 * `refreshedAt: new Date()`, and the staleness guard at the top of this loop
 * (`contact.personProfile.refreshedAt > staleBefore`) does not look at axis count — so a
 * person whose every subject was rejected got written as "freshly modelled" and silently
 * skipped by every NON-FORCE rebuild for 90 days, with no way to retry short of `force`.
 * `refreshedAt` must only advance when the person actually got something built.
 */
describe("refreshedAt only advances when the person actually got something built (Finding 2)", () => {
  const staleProfile = { id: "pp1", refreshedAt: new Date("2026-05-01T00:00:00Z") };

  it("does NOT advance refreshedAt on a rebuild whose every rationale was rejected", async () => {
    contactFindMany.mockResolvedValue([contact({ personProfile: staleProfile })]);
    gateRationales.mockResolvedValue({ kept: [], rejected: [{ label: "x", reason: "judged_generic" }], judged: true, deterministic: {} });

    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });

    expect(profileUpsert.mock.calls[0][0].update).not.toHaveProperty("refreshedAt");
  });

  /** Companion: a person who keeps at least one axis is still stamped as freshly built,
   *  exactly as before this fix. */
  it("still advances refreshedAt on a rebuild that keeps at least one axis", async () => {
    contactFindMany.mockResolvedValue([contact({ personProfile: staleProfile })]);
    // Default gateRationales mock (see beforeEach) keeps everything.

    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });

    expect(profileUpsert.mock.calls[0][0].update.refreshedAt).toBeInstanceOf(Date);
  });
});

describe("the INDUSTRY net survives a wholesale gate rejection", () => {
  const employerWithIndustry = () =>
    employer({
      profile: {
        ...usableProfile,
        industry: { canonical: "בנקאות ישראל", queries: ["ריבית בנק ישראל", "רגולציה בנקאית 2026"] },
      },
    });

  it("subscribes the person to the INDUSTRY axis even when every role axis is rejected", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    companyFindMany.mockResolvedValue([employerWithIndustry()]);
    gateRationales.mockResolvedValue({
      kept: [],
      rejected: [{ label: "כ-VP Assets, אחראי על", reason: "judged_generic" }],
      judged: true,
      deterministic: {},
    });

    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });

    expect(out.skipped.some((s) => s.reason === "all_rationales_generic")).toBe(true);
    expect(ensureIndustryAxis).toHaveBeenCalledWith({
      orgId: "org1",
      personProfileId: "pp1",
      industry: { canonical: "בנקאות ישראל", queries: ["ריבית בנק ישראל", "רגולציה בנקאית 2026"] },
    });
    // The industry proposal is never among what the gate judged — it is not part of
    // draft.axes at all, so it can never die on no_person_side.
    expect(gateRationales.mock.calls[0][1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: expect.stringContaining("בנקאות") })])
    );
    // There was nothing left to attach — the ROLE_COMPANY path never runs.
    expect(attachAxes).not.toHaveBeenCalled();
  });

  it("does not call ensureIndustryAxis when the employer profile has no industry field (legacy profile)", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    // Default employer() carries `usableProfile`, which has no `industry` — every
    // TrackedCompany researched before Task 5 looks like this.
    gateRationales.mockResolvedValue({ kept: [], rejected: [], judged: true, deterministic: {} });
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(ensureIndustryAxis).not.toHaveBeenCalled();
  });
});

/**
 * Task 11: a rejection now says which floor of the four-layer cake was missing, so a
 * human reading the skip log can tell "no person-specific field" (layer 4) apart from
 * "no company identity" (layer 2) apart from "the dated fact wasn't dated" (layer 3)
 * without opening layers.ts.
 */
describe("rejected-axis reason strings carry the missing layer (Task 11)", () => {
  it("suffixes a layer-4 rejection with קומה 4", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    gateRationales.mockResolvedValue({
      kept: [],
      rejected: [{ label: "כ-VP Assets, אחראי על", rationale: "r", reason: "no_person_side" }],
      judged: true,
      deterministic: { no_person_side: 1 },
    });
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.skipped.map((s) => s.reason)).toContain("axis_no_person_side [קומה 4 חסרה]: כ-VP Assets, אחראי על");
  });

  it("suffixes a layer-3 rejection (layer3_undated) with קומה 3", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    gateRationales.mockResolvedValue({
      kept: [],
      rejected: [{ label: "מהלכי מיזוג", rationale: "r", reason: "layer3_undated" }],
      judged: true,
      deterministic: { layer3_undated: 1 },
    });
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.skipped.map((s) => s.reason)).toContain("axis_layer3_undated [קומה 3 חסרה]: מהלכי מיזוג");
  });

  it("leaves a rule missingLayer doesn't recognise (contradicts_reasoning) with no suffix", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    gateRationales.mockResolvedValue({
      kept: [],
      rejected: [{ label: "סתירה", rationale: "r", reason: "contradicts_reasoning" }],
      judged: true,
      deterministic: { contradicts_reasoning: 1 },
    });
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.skipped.map((s) => s.reason)).toContain("axis_contradicts_reasoning: סתירה");
  });
});

/**
 * 2026-08-26 review, Important 1. The industry-net fix moved `personProfile.upsert`
 * ahead of the "all rejected" exit so ensureIndustryAxis would have a personProfileId to
 * subscribe to — but the force-detach was ALSO moved up in the same pass, and that is
 * data loss: a `force: true` rebuild whose draft is wholesale-rejected has nothing to
 * replace the person's existing axes WITH, so detaching them here would leave the person
 * with only the new INDUSTRY link and nothing else, on disk, permanently (un-muted links
 * are not soft-undoable from the UI). The fix keeps the detach exactly where it always
 * was: gated behind `gate.kept.length > 0`, same as attachAxes and ensureCompanyMonitorAxis.
 *
 * `scripts/radar-rebuild-people.ts` runs with `force: true` against real people, which is
 * what makes this a "tonight" bug rather than an eventual one.
 */
describe("force-mode data safety on a wholesale gate rejection", () => {
  const staleProfile = { id: "pp1", refreshedAt: new Date("2026-08-20T00:00:00Z") };

  it("does NOT detach existing un-muted axes when a force rebuild is wholesale-rejected", async () => {
    contactFindMany.mockResolvedValue([contact({ personProfile: staleProfile })]);
    gateRationales.mockResolvedValue({ kept: [], rejected: [], judged: true, deterministic: {} });

    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1", force: true });

    expect(personAxisDeleteMany).not.toHaveBeenCalled();
  });

  /** The companion case: force still does its job when the draft actually keeps axes. */
  it("still detaches existing un-muted axes on a force rebuild that keeps axes", async () => {
    contactFindMany.mockResolvedValue([contact({ personProfile: staleProfile })]);
    // Default gateRationales mock (see beforeEach) keeps everything.
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1", force: true });

    // NOT a bare { personProfileId, mutedAt } — see the next test. The delete must
    // exclude INDUSTRY, or it wipes out the net link ensureIndustryAxis just created.
    // MANUAL joined INDUSTRY in the exclusion on 2026-08-31 (Task 9): a MANUAL link is a
    // human's correction typed in on the person page, and a rebuild that deleted it would
    // make that control a lie. The exact predicate is pinned in
    // tests/unit/tech-radar-build-v2-wiring.test.ts.
    expect(personAxisDeleteMany).toHaveBeenCalledWith({
      where: { personProfileId: "pp1", mutedAt: null, source: { notIn: ["INDUSTRY", "MANUAL"] } },
    });
  });

  /**
   * 2026-08-26 review round 2. The round-1 fix put the force-detach back in its correct
   * position (gated behind gate.kept.length > 0) but left it unscoped by source — so on
   * EVERY successful force rebuild, the delete ran right after ensureIndustryAxis had
   * just (re)created that person's INDUSTRY link, wiping it back out moments later. Net
   * effect: the industry net contributes zero queries for every person a force rebuild
   * successfully processes — exactly what scripts/radar-rebuild-people.ts --write is
   * about to run tonight.
   *
   * Proven here, for a person who force-rebuilds with a KEPT (non-empty) draft: the
   * industry link is (re)created, and the detach that follows it explicitly spares
   * INDUSTRY while still clearing the old ROLE_COMPANY/COMPANY_MONITOR subjects it
   * exists to clear.
   */
  it("clears old subjects on a force rebuild without touching the INDUSTRY net link it just (re)created", async () => {
    contactFindMany.mockResolvedValue([contact({ personProfile: staleProfile })]);
    companyFindMany.mockResolvedValue([
      employer({
        profile: {
          ...usableProfile,
          industry: { canonical: "ספורט דיגיטלי", queries: ["חדשות ספורט דיגיטלי"] },
        },
      }),
    ]);
    // Default gateRationales mock (see beforeEach) keeps everything — the normal,
    // successful case this bug hit on every run.

    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1", force: true });

    // The industry net was (re)subscribed...
    expect(ensureIndustryAxis).toHaveBeenCalledWith({
      orgId: "org1",
      personProfileId: "pp1",
      industry: { canonical: "ספורט דיגיטלי", queries: ["חדשות ספורט דיגיטלי"] },
    });
    // ...and the detach that runs after it explicitly spares INDUSTRY while still
    // clearing everything else un-muted.
    // MANUAL joined INDUSTRY in the exclusion on 2026-08-31 (Task 9): a MANUAL link is a
    // human's correction typed in on the person page, and a rebuild that deleted it would
    // make that control a lie. The exact predicate is pinned in
    // tests/unit/tech-radar-build-v2-wiring.test.ts.
    expect(personAxisDeleteMany).toHaveBeenCalledWith({
      where: { personProfileId: "pp1", mutedAt: null, source: { notIn: ["INDUSTRY", "MANUAL"] } },
    });
  });
});

/**
 * Task 10: the layer cake's output has to land somewhere durable, or it dies the moment
 * the process exits. `domains` on the profile, `evidence` on each axis link, and the
 * counting report fields that make what got shared vs. researched from scratch visible.
 */
describe("persisting the model's receipts (Task 10)", () => {
  it("persists the parsed domains on both the create and the update branch of the profile upsert", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    const expected = [{ domain: "מנוע המלצות", kind: "found", source: "title", evidence: "VP-R&D" }];
    expect(profileUpsert.mock.calls[0][0].create.domains).toEqual(expected);
    expect(profileUpsert.mock.calls[0][0].update.domains).toEqual(expected);
  });

  it("threads the full evidence shape into the proposal handed to attachAxes, tagged from the matching domain", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(attachAxes.mock.calls[0][0].proposals[0].evidence).toEqual({
      personDecision: "מחזיק את החלטת מנוע ההמלצות",
      companyFact: "לקוחות פרטיים שצורכים תוצאות ספורט",
      domain: "מנוע המלצות",
      domainKind: "found",
      domainSource: "title",
      layerEvidence: { layer: 2, quote: "מוכר תוצאות ספורט ללקוחות פרטיים" },
    });
  });

  /**
   * Task 8's own interface note left this owed to Task 10: ensureIndustryAxis already
   * skips silently when the employer profile predates research v2 (no `industry`
   * field) — the CONTROLLER AMENDMENT's one new obligation is naming that skip.
   */
  it('emits a "no_industry" note naming the employer when its research profile has no industry field', async () => {
    contactFindMany.mockResolvedValue([contact()]);
    // Default employer() carries usableProfile, which has no `industry` — every
    // TrackedCompany researched before Task 5 looks like this.
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.notes).toContain("no_industry: 365Scores");
    expect(ensureIndustryAxis).not.toHaveBeenCalled();
  });

  it("does not emit a no_industry note when the employer profile has an industry", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    companyFindMany.mockResolvedValue([
      employer({
        profile: { ...usableProfile, industry: { canonical: "ספורט דיגיטלי", queries: ["חדשות ספורט דיגיטלי"] } },
      }),
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.notes).toEqual([]);
    expect(ensureIndustryAxis).toHaveBeenCalled();
  });

  /**
   * The 2-person same-industry fixture the brief specifies: two employers in the same
   * industry, whose marked people (in production) would share ONE INDUSTRY axis; one
   * person entirely found, the other entirely derived. Proves all four new report
   * fields at once, including the savedQueries formula: Σ over INDUSTRY axes of
   * (distinct subscriber employers − 1) × its query count.
   */
  it("computes domainsByPerson, allDerived, layerQueries and industryShared over a 2-person same-industry cohort", async () => {
    contactFindMany.mockResolvedValue([
      contact({ id: "c1", fullName: "Roy Hayumi", currentCompany: "365Scores" }),
      contact({ id: "c2", fullName: "Dana Cohen", currentCompany: "Sport365" }),
    ]);
    companyFindMany.mockResolvedValue([
      employer({ id: "tc1", name: "365Scores" }),
      employer({ id: "tc2", name: "Sport365" }),
    ]);
    profileUpsert.mockResolvedValueOnce({ id: "pp1" }).mockResolvedValueOnce({ id: "pp2" });
    buildPersonProfile
      .mockResolvedValueOnce({
        roleLens: "בונה את מנוע ההמלצות",
        domains: [{ domain: "מנוע המלצות", kind: "found", source: "title", evidence: "VP-R&D" }],
        axes: [{
          label: "קונסולידציה של מסדי וקטורים", key: "k1", searchQueries: ["role query 1"],
          rationale: "כי הוא בנה את זה", stage: "decision",
          domain: "מנוע המלצות",
          layerEvidence: { layer: 2, quote: "quote1" },
          personDecision: "d1", companyFact: "f1",
        }],
      })
      .mockResolvedValueOnce({
        roleLens: "מנהלת שיווק",
        domains: [{ domain: "שיווק דיגיטלי", kind: "derived", source: null, evidence: "role x company" }],
        axes: [{
          label: "מגמות שיווק ספורט", key: "k2", searchQueries: ["role query 2"],
          rationale: "כי היא מנהלת את זה", stage: "competitor",
          domain: "שיווק דיגיטלי",
          layerEvidence: { layer: 3, quote: "quote2", dateIso: "2026-08-01" },
          personDecision: "d2", companyFact: "f2",
        }],
      });
    // The DB read-back: two employers subscribed to the SAME shared INDUSTRY axis, plus
    // their own ROLE_COMPANY axis each. `status: "ACTIVE"` and `mutedAt: null` on every
    // row — the report must only count what the pool would actually fetch.
    profileFindMany.mockResolvedValue([
      {
        contact: { fullName: "Roy Hayumi" },
        employerTrackedCompanyId: "tc1",
        axes: [
          { agenda: true, mutedAt: null, axis: { id: "ax-role1", kind: "ROLE_COMPANY", status: "ACTIVE", searchQueries: ["role query 1"] } },
          { agenda: false, mutedAt: null, axis: { id: "ax-industry-1", kind: "INDUSTRY", status: "ACTIVE", searchQueries: ["חדשות ספורט", "sports industry outlook"] } },
        ],
      },
      {
        contact: { fullName: "Dana Cohen" },
        employerTrackedCompanyId: "tc2",
        axes: [
          { agenda: true, mutedAt: null, axis: { id: "ax-role2", kind: "ROLE_COMPANY", status: "ACTIVE", searchQueries: ["role query 2"] } },
          { agenda: false, mutedAt: null, axis: { id: "ax-industry-1", kind: "INDUSTRY", status: "ACTIVE", searchQueries: ["חדשות ספורט", "sports industry outlook"] } },
        ],
      },
    ]);

    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });

    expect(out.domainsByPerson).toEqual(
      expect.arrayContaining([
        { name: "Roy Hayumi", found: 1, derived: 0 },
        { name: "Dana Cohen", found: 0, derived: 1 },
      ])
    );
    expect(out.domainsByPerson).toHaveLength(2);
    expect(out.allDerived).toEqual(["Dana Cohen"]);
    expect(out.layerQueries).toEqual({ industry: 2, companyMonitor: 0, person: 2 });
    // ax-industry-1 has 2 distinct subscriber employers (tc1, tc2) and 2 queries:
    // savedQueries = (2 − 1) × 2 = 2 — the brief's "1 × queryCount".
    expect(out.industryShared).toEqual({ industries: 1, employers: 2, savedQueries: 2 });
  });

  /**
   * Fix round 1: the read-back used raw `searchQueries.length`, with no cap — so
   * `savedQueries` could overstate the industry net's real recall benefit by up to 2.5x
   * relative to what the pool (capped by MAX_QUERIES_PER_AXIS, mocked here to 3) would
   * actually fetch. Mirrors the SAME effective cap the pool itself uses, not a hardcoded
   * number.
   */
  it("caps layerQueries and industryShared.savedQueries at the pool's own effective per-axis limit, not raw searchQueries.length", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    const fiveQueries = ["q1", "q2", "q3", "q4", "q5"];
    profileFindMany.mockResolvedValue([
      {
        contact: { fullName: "Roy Hayumi" },
        employerTrackedCompanyId: "tc1",
        axes: [
          { agenda: false, mutedAt: null, axis: { id: "ax-industry-1", kind: "INDUSTRY", status: "ACTIVE", searchQueries: fiveQueries } },
        ],
      },
      {
        contact: { fullName: "Dana Cohen" },
        employerTrackedCompanyId: "tc2",
        axes: [
          { agenda: false, mutedAt: null, axis: { id: "ax-industry-1", kind: "INDUSTRY", status: "ACTIVE", searchQueries: fiveQueries } },
        ],
      },
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    // 5 raw queries, capped at MAX_QUERIES_PER_AXIS (mocked to 3) — the pool would never
    // fetch q4/q5.
    expect(out.layerQueries.industry).toBe(3);
    // 2 distinct subscriber employers, CAPPED queryCount 3: (2 − 1) × 3 = 3, not
    // (2 − 1) × 5 = 5.
    expect(out.industryShared).toEqual({ industries: 1, employers: 2, savedQueries: 3 });
  });

  /** A muted link is not scanned (axis-store.ts) — it must not count as a saved query
   *  or as a subscriber employer either. */
  it("excludes a muted PersonAxis link from layerQueries and industryShared", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    profileFindMany.mockResolvedValue([
      {
        contact: { fullName: "Roy Hayumi" },
        employerTrackedCompanyId: "tc1",
        axes: [{ agenda: false, mutedAt: null, axis: { id: "ax-industry-1", kind: "INDUSTRY", status: "ACTIVE", searchQueries: ["q1"] } }],
      },
      {
        contact: { fullName: "Dana Cohen" },
        employerTrackedCompanyId: "tc2",
        axes: [{ agenda: false, mutedAt: new Date("2026-08-20T00:00:00Z"), axis: { id: "ax-industry-1", kind: "INDUSTRY", status: "ACTIVE", searchQueries: ["q1"] } }],
      },
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.industryShared).toEqual({ industries: 1, employers: 1, savedQueries: 0 });
  });

  /** A retired/merged axis can still be joined via a stale PersonAxis row; it must not
   *  count towards a report describing what the pool actually fetches. */
  it("excludes a non-ACTIVE axis from layerQueries and industryShared", async () => {
    contactFindMany.mockResolvedValue([contact()]);
    profileFindMany.mockResolvedValue([
      {
        contact: { fullName: "Roy Hayumi" },
        employerTrackedCompanyId: "tc1",
        axes: [{ agenda: false, mutedAt: null, axis: { id: "ax-old", kind: "INDUSTRY", status: "MERGED", searchQueries: ["q1", "q2"] } }],
      },
    ]);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.layerQueries).toEqual({ industry: 0, companyMonitor: 0, person: 0 });
    expect(out.industryShared).toEqual({ industries: 0, employers: 0, savedQueries: 0 });
  });

  /**
   * Fix round 1, Important 2: ensureIndustryAxis's `null` return (the all-filler-canonical
   * guard Task 8 added) was silently discarded — a person whose employer's industry
   * canonical normalises to nothing got NO industry link and no explanation why.
   */
  it('emits an "industry_key_empty" note when ensureIndustryAxis returns null (the all-filler-canonical guard)', async () => {
    contactFindMany.mockResolvedValue([contact()]);
    companyFindMany.mockResolvedValue([
      employer({ profile: { ...usableProfile, industry: { canonical: "the of and", queries: ["q"] } } }),
    ]);
    ensureIndustryAxis.mockResolvedValueOnce(null);
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.notes).toContain("industry_key_empty: 365Scores");
    expect(out.notes).not.toContain("no_industry: 365Scores");
  });
});
