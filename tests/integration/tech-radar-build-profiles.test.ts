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
  for (const m of [contactFindMany, companyFindMany, profileUpsert, profileFindMany, buildPersonProfile, attachAxes, ensureCompanyMonitorAxis]) m.mockReset();
  // The invariant read-back: verified against the DB, not against the model's response.
  profileFindMany.mockResolvedValue([]);
  companyFindMany.mockResolvedValue([employer()]);
  profileUpsert.mockResolvedValue({ id: "pp1" });
  buildPersonProfile.mockResolvedValue({
    roleLens: "בונה את מנוע ההמלצות",
    axes: [{ label: "קונסולידציה של מסדי וקטורים", key: "k", searchQueries: ["q"], rationale: "כי הוא בנה את זה" }],
  });
  attachAxes.mockResolvedValue({ attached: 1, created: 1, merged: 0, skipped: [] });
  ensureCompanyMonitorAxis.mockResolvedValue("ax-mon");
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
    attachAxes.mockResolvedValue({ attached: 0, created: 0, merged: 0, skipped: [{ label: "תחום", reason: "empty_key" }] });
    const out = await buildProfilesForMarked({ orgId: "org1", ownerId: "u1" });
    expect(out.skipped[0].reason).toMatch(/axis_empty_key: תחום/);
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
