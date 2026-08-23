import { describe, it, expect, vi, beforeEach } from "vitest";

const axisFindMany = vi.fn();
const axisCreate = vi.fn();
const axisUpdate = vi.fn();
const axisUpsert = vi.fn();
const personAxisCount = vi.fn();
const personAxisUpsert = vi.fn();
const personAxisGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: {
      findMany: (...a: unknown[]) => axisFindMany(...a),
      create: (...a: unknown[]) => axisCreate(...a),
      update: (...a: unknown[]) => axisUpdate(...a),
      upsert: (...a: unknown[]) => axisUpsert(...a),
    },
    personAxis: {
      count: (...a: unknown[]) => personAxisCount(...a),
      upsert: (...a: unknown[]) => personAxisUpsert(...a),
      groupBy: (...a: unknown[]) => personAxisGroupBy(...a),
    },
  },
}));

const resolveMergeQuestions = vi.fn();
vi.mock("@/lib/tech-radar/axis-merge", () => ({
  resolveMergeQuestions: (...a: unknown[]) => resolveMergeQuestions(...a),
}));

const { attachAxes, ensureCompanyMonitorAxis } = await import("@/lib/tech-radar/axis-store");
const { normalizeAxisKey, MAX_AXES_PER_ORG, MAX_AXES_PER_PERSON } = await import("@/lib/tech-radar/axis");

const proposal = (label: string, rationale = "כי הוא בנה את זה") => ({
  label,
  key: normalizeAxisKey(label),
  searchQueries: ["vector search research"],
  rationale,
  agenda: false,
});

beforeEach(() => {
  for (const m of [axisFindMany, axisCreate, axisUpdate, axisUpsert, personAxisCount, personAxisUpsert, personAxisGroupBy, resolveMergeQuestions]) {
    m.mockReset();
  }
  // Default: the model says every proposal is a new subject.
  resolveMergeQuestions.mockResolvedValue(new Map());
  axisFindMany.mockResolvedValue([]);
  personAxisCount.mockResolvedValue(0);
  personAxisUpsert.mockResolvedValue({ id: "pa1", createdAt: new Date("2026-08-23T00:00:00Z") });
  personAxisGroupBy.mockResolvedValue([]);
  let n = 0;
  axisCreate.mockImplementation(({ data }: { data: { key: string; label: string } }) =>
    Promise.resolve({ id: `ax${++n}`, key: data.key, label: data.label })
  );
});

describe("attachAxes", () => {
  it("creates an axis nobody has yet, and attaches the person to it", async () => {
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", proposals: [proposal("קונסולידציה של מסדי וקטורים")] });
    expect(out).toMatchObject({ created: 1, merged: 0, attached: 1 });
    expect(personAxisUpsert.mock.calls[0][0].create.rationale).toBe("כי הוא בנה את זה");
  });

  /** The point of the gate: a second person proposing the same subject joins, not mints. */
  it("attaches to an existing axis instead of creating a synonym", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-existing", key: normalizeAxisKey("זיהוי הונאות"), label: "זיהוי הונאות" },
    ]);
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp2", proposals: [proposal("הונאות זיהוי")] });
    expect(out).toMatchObject({ created: 0, merged: 1, attached: 1 });
    expect(axisCreate).not.toHaveBeenCalled();
    expect(personAxisUpsert.mock.calls[0][0].where.personProfileId_axisId.axisId).toBe("ax-existing");
  });

  it("only queries ACTIVE axes, since a merged axis is not a merge target", async () => {
    await attachAxes({ orgId: "org1", personProfileId: "pp1", proposals: [proposal("זיהוי הונאות")] });
    expect(axisFindMany.mock.calls[0][0].where).toEqual({ orgId: "org1", status: "ACTIVE" });
  });

  /** Never silent: a dropped proposal has a recorded reason. */
  it("records a rejected label rather than dropping it quietly", async () => {
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", proposals: [proposal("תחום")] });
    expect(out.attached).toBe(0);
    expect(out.skipped).toEqual([{ label: "תחום", reason: "empty_key" }]);
  });

  it("records the ceiling that stopped a creation", async () => {
    personAxisCount.mockResolvedValue(MAX_AXES_PER_PERSON);
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", proposals: [proposal("אנרגיה מתחדשת")] });
    expect(out.created).toBe(0);
    expect(out.skipped).toEqual([{ label: "אנרגיה מתחדשת", reason: "person_ceiling" }]);
  });

  it("stops creating at the org ceiling, and says so when nothing is near", async () => {
    axisFindMany.mockResolvedValue(
      Array.from({ length: MAX_AXES_PER_ORG }, (_, i) => ({ id: `a${i}`, key: `k${i}`, label: `נושא ייחודי מספר ${i}` }))
    );
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", proposals: [proposal("אנרגיה מתחדשת")] });
    expect(axisCreate).not.toHaveBeenCalled();
    expect(out.skipped[0].reason).toBe("org_ceiling");
  });

  /**
   * The spec's ceiling fallback — attach to the nearest rather than drop the person —
   * but only when "nearest" means something. With ASK_ABOVE at 0 the nearest axis can
   * have zero overlap, and filing a renewable-energy interest under core banking is
   * worse than recording that the ceiling was hit.
   */
  it("folds a ceiling-hit proposal into a genuinely near axis", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-fraud", key: normalizeAxisKey("זיהוי הונאות בתשלומים"), label: "זיהוי הונאות בתשלומים" },
      ...Array.from({ length: MAX_AXES_PER_ORG - 1 }, (_, i) => ({ id: `a${i}`, key: `k${i}`, label: `נושא ייחודי ${i}` })),
    ]);
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1",
      proposals: [proposal("זיהוי הונאות בהעברות")],
    });
    expect(axisCreate).not.toHaveBeenCalled();
    expect(out.merged).toBe(1);
    expect(out.skipped).toHaveLength(0);
  });

  /** Re-running a build must not overwrite a weight the learning loop has moved. */
  /** `weight` is moved by the learning loop; a rebuild must not reset it. */
  it("upserts the link without touching its weight", async () => {
    await attachAxes({ orgId: "org1", personProfileId: "pp1", proposals: [proposal("זיהוי הונאות")] });
    expect(personAxisUpsert.mock.calls[0][0].update).toEqual({
      rationale: "כי הוא בנה את זה",
      agenda: false,
    });
    expect(Object.keys(personAxisUpsert.mock.calls[0][0].update)).not.toContain("weight");
  });

  /** Recomputed, not incremented, so a retry cannot inflate the width guard's input. */
  it("recomputes subscriberCount from the join table", async () => {
    personAxisGroupBy.mockResolvedValue([{ axisId: "ax1", _count: { axisId: 3 } }]);
    await attachAxes({ orgId: "org1", personProfileId: "pp1", proposals: [proposal("זיהוי הונאות")] });
    expect(axisUpdate).toHaveBeenCalledWith({ where: { id: "ax1" }, data: { subscriberCount: 3 } });
  });

  it("keeps going after one bad proposal", async () => {
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1",
      proposals: [proposal("תחום"), proposal("זיהוי הונאות בתשלומים")],
    });
    expect(out.created).toBe(1);
    expect(out.skipped).toHaveLength(1);
  });
});

describe("ensureCompanyMonitorAxis", () => {
  it("is keyed structurally so it can never collide with a label", async () => {
    axisUpsert.mockResolvedValue({ id: "ax-mon" });
    const id = await ensureCompanyMonitorAxis({ orgId: "org1", trackedCompanyId: "tc1", companyName: "365Scores" });
    expect(id).toBe("ax-mon");
    expect(axisUpsert.mock.calls[0][0].where.orgId_key.key).toBe("company:tc1");
    expect(axisUpsert.mock.calls[0][0].create.kind).toBe("COMPANY_MONITOR");
  });

  /** Idempotent: a second call must not rewrite a label someone may have edited. */
  it("does not overwrite an existing monitor axis", async () => {
    axisUpsert.mockResolvedValue({ id: "ax-mon" });
    await ensureCompanyMonitorAxis({ orgId: "org1", trackedCompanyId: "tc1", companyName: "365Scores" });
    expect(axisUpsert.mock.calls[0][0].update).toEqual({});
  });
});

/**
 * Level 3. The first live build skipped this entirely and produced three axes for one
 * subject at one company; these pin that it is now consulted and obeyed.
 */
describe("attachAxes level-3 merge", () => {
  const live = { id: "ax-live", key: normalizeAxisKey("עיכוב בהעברת נתונים חי וגודל תפוקה"), label: "עיכוב בהעברת נתונים חי וגודל תפוקה" };

  it("attaches to the axis the model named, instead of creating a duplicate", async () => {
    axisFindMany.mockResolvedValue([live]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-live"]]));
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp2",
      proposals: [proposal("עיבוד נתונים בזמן אמת בקנה מידה ענק")],
    });
    expect(out).toMatchObject({ created: 0, merged: 1, attached: 1 });
    expect(axisCreate).not.toHaveBeenCalled();
    expect(personAxisUpsert.mock.calls[0][0].where.personProfileId_axisId.axisId).toBe("ax-live");
  });

  it("asks once for the whole set, not once per proposal", async () => {
    axisFindMany.mockResolvedValue([live]);
    await attachAxes({
      orgId: "org1",
      personProfileId: "pp2",
      proposals: [proposal("נושא ראשון ייחודי"), proposal("נושא שני ייחודי"), proposal("נושא שלישי ייחודי")],
    });
    expect(resolveMergeQuestions).toHaveBeenCalledTimes(1);
    expect(resolveMergeQuestions.mock.calls[0][1]).toHaveLength(3);
  });

  it("creates when the model says the subject is new", async () => {
    axisFindMany.mockResolvedValue([live]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, null]]));
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp2", proposals: [proposal("אנרגיה מתחדשת")] });
    expect(out.created).toBe(1);
  });

  /** A free exact-key hit must not spend a call. */
  it("does not ask about a proposal the free levels already settled", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-fraud", key: normalizeAxisKey("זיהוי הונאות"), label: "זיהוי הונאות" },
    ]);
    await attachAxes({ orgId: "org1", personProfileId: "pp2", proposals: [proposal("הונאות זיהוי")] });
    expect(resolveMergeQuestions).not.toHaveBeenCalled();
  });
});
