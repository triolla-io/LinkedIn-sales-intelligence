import { describe, it, expect, vi, beforeEach } from "vitest";

const axisFindMany = vi.fn();
const axisFindUnique = vi.fn();
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
      findUnique: (...a: unknown[]) => axisFindUnique(...a),
      create: (...a: unknown[]) => axisCreate(...a),
      update: (...a: unknown[]) => axisUpdate(...a),
      upsert: (...a: unknown[]) => axisUpsert(...a),
    },
    trackedCompany: {
      findMany: (...a: unknown[]) => trackedCompanyFindMany(...a),
    },
    personAxis: {
      count: (...a: unknown[]) => personAxisCount(...a),
      upsert: (...a: unknown[]) => personAxisUpsert(...a),
      groupBy: (...a: unknown[]) => personAxisGroupBy(...a),
      findMany: (...a: unknown[]) => personAxisFindMany(...a),
      update: (...a: unknown[]) => personAxisUpdate(...a),
    },
  },
}));

const trackedCompanyFindMany = vi.fn();
const personAxisFindMany = vi.fn();
const personAxisUpdate = vi.fn();
const resolveMergeQuestions = vi.fn();
vi.mock("@/lib/tech-radar/axis-merge", () => ({
  resolveMergeQuestions: (...a: unknown[]) => resolveMergeQuestions(...a),
}));

const { attachAxes, ensureCompanyMonitorAxis, ensureIndustryAxis } = await import("@/lib/tech-radar/axis-store");
const { normalizeAxisKey, industryKey, MAX_AXES_PER_ORG, MAX_AXES_PER_PERSON } = await import("@/lib/tech-radar/axis");
const { MAX_INDUSTRY_QUERIES } = await import("@/lib/tech-radar/types");

const proposal = (label: string, rationale = "כי הוא בנה את זה") => ({
  label,
  key: normalizeAxisKey(label),
  searchQueries: ["vector search research"],
  rationale,
  // The declared two sides of the crossing. attachAxes does not read them — it decides on
  // the label, the queries and the employer — but a proposal is not a proposal without them.
  personDecision: "היא חותמת על חוויית הלקוח בריטייל",
  companyFact: "הפועלים השיקה אפליקציה חדשה",
  stage: "competitor" as const,
  agenda: false,
});

/**
 * The 2026-08-26 cohort's employers, in the shape research writes them. Gil Tamir sits at
 * Phoenix (insurance); Elinor at Bank Leumi; Erez and Pazit at Bank Hapoalim.
 */
const HAPOALIM = {
  employerId: "tc-hapoalim",
  names: ["Bank Hapoalim", "בנק הפועלים"],
  namedCompetitors: [
    "Bank Leumi / בנק לאומי / לאומי",
    "Israel Discount Bank / בנק דיסקונט / דיסקונט",
    "Mizrahi-Tefahot / מזרחי טפחות",
  ],
};
const LEUMI = {
  employerId: "tc-leumi",
  names: ["Bank Leumi", "בנק לאומי"],
  namedCompetitors: [
    "Bank Hapoalim / בנק הפועלים / הפועלים",
    "Israel Discount Bank / בנק דיסקונט / דיסקונט",
    "Mizrahi-Tefahot / מזרחי טפחות",
  ],
};
const PHOENIX_ROW = {
  id: "tc-phoenix",
  name: "The Phoenix Holdings",
  aliases: ["הפניקס"],
  profile: {
    namedCompetitors: ["Harel Insurance / הראל", "Migdal Insurance / מגדל", "Bank Hapoalim / בנק הפועלים"],
  },
};
const HAPOALIM_ROW = {
  id: "tc-hapoalim",
  name: "Bank Hapoalim",
  aliases: ["בנק הפועלים"],
  profile: { namedCompetitors: HAPOALIM.namedCompetitors },
};

/**
 * An existing axis and the employer its subscribers work at. Defaults to ROLE_COMPANY —
 * every fixture in this file predates the `kind` field the layer-cake schema added, and
 * these rows are, in reality, ordinary subject axes.
 */
function ownedAxis(id: string, label: string, employerId: string | null, kind: string = "ROLE_COMPANY") {
  return {
    id,
    key: normalizeAxisKey(label),
    label,
    kind,
    people: [{ personProfile: { employerTrackedCompanyId: employerId } }],
  };
}

beforeEach(() => {
  for (const m of [axisFindMany, axisFindUnique, axisCreate, axisUpdate, axisUpsert, personAxisCount, personAxisUpsert, personAxisGroupBy, resolveMergeQuestions, personAxisFindMany, personAxisUpdate, trackedCompanyFindMany]) {
    m.mockReset();
  }
  personAxisFindMany.mockResolvedValue([{ id: "pa1", agenda: true }]);
  // Default: the model says every proposal is a new subject.
  resolveMergeQuestions.mockResolvedValue(new Map());
  axisFindMany.mockResolvedValue([]);
  trackedCompanyFindMany.mockResolvedValue([]);
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
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("קונסולידציה של מסדי וקטורים")] });
    expect(out).toMatchObject({ created: 1, merged: 0, attached: 1 });
    expect(personAxisUpsert.mock.calls[0][0].create.rationale).toBe("כי הוא בנה את זה");
  });

  /** The point of the gate: a second person proposing the same subject joins, not mints. */
  it("attaches to an existing axis instead of creating a synonym", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-existing", key: normalizeAxisKey("זיהוי הונאות"), label: "זיהוי הונאות", kind: "ROLE_COMPANY" },
    ]);
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp2", employer: HAPOALIM, proposals: [proposal("הונאות זיהוי")] });
    expect(out).toMatchObject({ created: 0, merged: 1, attached: 1 });
    expect(axisCreate).not.toHaveBeenCalled();
    expect(personAxisUpsert.mock.calls[0][0].where.personProfileId_axisId.axisId).toBe("ax-existing");
  });

  it("only queries ACTIVE axes, since a merged axis is not a merge target", async () => {
    await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("זיהוי הונאות")] });
    expect(axisFindMany.mock.calls[0][0].where).toEqual({ orgId: "org1", status: "ACTIVE" });
  });

  /** Never silent: a dropped proposal has a recorded reason. */
  it("records a rejected label rather than dropping it quietly", async () => {
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("תחום")] });
    expect(out.attached).toBe(0);
    expect(out.skipped).toEqual([{ label: "תחום", reason: "empty_key" }]);
  });

  it("records the ceiling that stopped a creation", async () => {
    personAxisCount.mockResolvedValue(MAX_AXES_PER_PERSON);
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("אנרגיה מתחדשת")] });
    expect(out.created).toBe(0);
    expect(out.skipped).toEqual([{ label: "אנרגיה מתחדשת", reason: "person_ceiling" }]);
  });

  it("stops creating at the org ceiling, and says so when nothing is near", async () => {
    axisFindMany.mockResolvedValue(
      Array.from({ length: MAX_AXES_PER_ORG }, (_, i) => ({ id: `a${i}`, key: `k${i}`, label: `נושא ייחודי מספר ${i}`, kind: "ROLE_COMPANY" }))
    );
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("אנרגיה מתחדשת")] });
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
      { id: "ax-fraud", key: normalizeAxisKey("זיהוי הונאות בתשלומים"), label: "זיהוי הונאות בתשלומים", kind: "ROLE_COMPANY" },
      ...Array.from({ length: MAX_AXES_PER_ORG - 1 }, (_, i) => ({ id: `a${i}`, key: `k${i}`, label: `נושא ייחודי ${i}`, kind: "ROLE_COMPANY" })),
    ]);
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1", employer: HAPOALIM,
      proposals: [proposal("זיהוי הונאות בהעברות")],
    });
    expect(axisCreate).not.toHaveBeenCalled();
    expect(out.merged).toBe(1);
    expect(out.skipped).toHaveLength(0);
  });

  /** Re-running a build must not overwrite a weight the learning loop has moved. */
  /** `weight` is moved by the learning loop; a rebuild must not reset it. */
  it("upserts the link without touching its weight", async () => {
    await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("זיהוי הונאות")] });
    expect(personAxisUpsert.mock.calls[0][0].update).toEqual({
      rationale: "כי הוא בנה את זה",
      agenda: false,
    });
    expect(Object.keys(personAxisUpsert.mock.calls[0][0].update)).not.toContain("weight");
  });

  /** Recomputed, not incremented, so a retry cannot inflate the width guard's input. */
  it("recomputes subscriberCount from the join table", async () => {
    personAxisGroupBy.mockResolvedValue([{ axisId: "ax1", _count: { axisId: 3 } }]);
    await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("זיהוי הונאות")] });
    expect(axisUpdate).toHaveBeenCalledWith({ where: { id: "ax1" }, data: { subscriberCount: 3 } });
  });

  it("keeps going after one bad proposal", async () => {
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1", employer: HAPOALIM,
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
  const live = { id: "ax-live", key: normalizeAxisKey("עיכוב בהעברת נתונים חי וגודל תפוקה"), label: "עיכוב בהעברת נתונים חי וגודל תפוקה", kind: "ROLE_COMPANY" };

  it("attaches to the axis the model named, instead of creating a duplicate", async () => {
    axisFindMany.mockResolvedValue([live]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-live"]]));
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp2", employer: HAPOALIM,
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
      personProfileId: "pp2", employer: HAPOALIM,
      proposals: [proposal("נושא ראשון ייחודי"), proposal("נושא שני ייחודי"), proposal("נושא שלישי ייחודי")],
    });
    expect(resolveMergeQuestions).toHaveBeenCalledTimes(1);
    expect(resolveMergeQuestions.mock.calls[0][1]).toHaveLength(3);
  });

  it("creates when the model says the subject is new", async () => {
    axisFindMany.mockResolvedValue([live]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, null]]));
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp2", employer: HAPOALIM, proposals: [proposal("אנרגיה מתחדשת")] });
    expect(out.created).toBe(1);
  });

  /** A free exact-key hit must not spend a call. */
  it("does not ask about a proposal the free levels already settled", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-fraud", key: normalizeAxisKey("זיהוי הונאות"), label: "זיהוי הונאות", kind: "ROLE_COMPANY" },
    ]);
    await attachAxes({ orgId: "org1", personProfileId: "pp2", employer: HAPOALIM, proposals: [proposal("הונאות זיהוי")] });
    expect(resolveMergeQuestions).not.toHaveBeenCalled();
  });
});

/**
 * The "exactly one agenda axis" guarantee is enforced when proposals are parsed, which
 * is BEFORE the merge gate. On 2026-08-23 three of six people lost their agenda axis to
 * a ceiling or a rejection and ended with role axes only — the exact thing the agenda
 * axis exists to prevent, and what the veto rejected them for.
 */
describe("attachAxes protects the agenda axis", () => {
  const agenda = (label: string) => ({ ...proposal(label), agenda: true });

  it("processes the agenda proposal first, so a ceiling cannot squeeze it out", async () => {
    axisFindMany.mockResolvedValue([]);
    await attachAxes({
      orgId: "org1",
      personProfileId: "pp1", employer: HAPOALIM,
      proposals: [proposal("נושא תפקיד ראשון"), proposal("נושא תפקיד שני"), agenda("הרחבת הקיבולת שהוכרזה")],
    });
    expect(axisCreate.mock.calls[0][0].data.label).toBe("הרחבת הקיבולת שהוכרזה");
  });

  it("marks the link as agenda", async () => {
    axisFindMany.mockResolvedValue([]);
    await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [agenda("הרחבת הקיבולת")] });
    expect(personAxisUpsert.mock.calls[0][0].create.agenda).toBe(true);
  });

  it("promotes a surviving link when the agenda proposal was dropped anyway", async () => {
    axisFindMany.mockResolvedValue([]);
    personAxisFindMany.mockResolvedValue([{ id: "pa-first", agenda: false }, { id: "pa-2", agenda: false }]);
    const out = await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [proposal("נושא תפקיד")] });
    expect(personAxisUpdate).toHaveBeenCalledWith({ where: { id: "pa-first" }, data: { agenda: true } });
    expect(out.skipped.map((s) => s.reason)).toContain("agenda_proposal_dropped_promoted_first_link");
  });

  it("does not promote when an agenda link already exists", async () => {
    axisFindMany.mockResolvedValue([]);
    personAxisFindMany.mockResolvedValue([{ id: "pa1", agenda: true }]);
    await attachAxes({ orgId: "org1", personProfileId: "pp1", employer: HAPOALIM, proposals: [agenda("הרחבת הקיבולת")] });
    expect(personAxisUpdate).not.toHaveBeenCalled();
  });
})


/**
 * The competitive-set gate — part (ג) of the 2026-08-26 fix.
 *
 * Gil Tamir (Phoenix, insurance) was processed first and created
 * "תחרות דיגיטלית מול הראל ומגדל". Elinor Levinson Gafni (Bank Leumi) proposed her own
 * competitive axis, correctly naming הפועלים, דיסקונט ומזרחי-טפחות — and the merge folded
 * her into Gil's. The RadarAxis row owns the QUERIES, so a VP Product at a bank spent one
 * of her two axes on "ביטוח הראל אפליקציה דיגיטלית חדשה". Label similarity is blind to
 * the employer; these pin that it no longer decides alone.
 */
describe("attachAxes competitive-set gate", () => {
  const gilsAxis = ownedAxis("ax-gil", "תחרות דיגיטלית מול הראל ומגדל", "tc-phoenix");

  it("refuses the model's cross-sector merge and creates the bank's own axis", async () => {
    axisFindMany.mockResolvedValue([gilsAxis]);
    trackedCompanyFindMany.mockResolvedValue([PHOENIX_ROW]);
    // Exactly what the live run answered.
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-gil"]]));

    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp-elinor",
      employer: LEUMI,
      proposals: [proposal("תחרות מוצרית מול הפועלים ודיסקונט")],
    });

    expect(out).toMatchObject({ created: 1, merged: 0, refused: 1, attached: 1 });
    expect(out.mergeRefused).toHaveLength(1);
    expect(out.mergeRefused[0].label).toBe("תחרות מוצרית מול הפועלים ודיסקונט");
    // Both halves named: the axis that was refused and the employer that blocked it.
    expect(out.mergeRefused[0].reason).toContain("תחרות דיגיטלית מול הראל ומגדל");
    expect(out.mergeRefused[0].reason).toContain("The Phoenix Holdings");
    expect(personAxisUpsert.mock.calls[0][0].where.personProfileId_axisId.axisId).not.toBe("ax-gil");
  });

  /** The free similarity level is gated too — 0.6 overlap across sectors is still wrong. */
  it("refuses a high-similarity merge across sectors", async () => {
    axisFindMany.mockResolvedValue([ownedAxis("ax-gil", "תחרות דיגיטלית מול הראל", "tc-phoenix")]);
    trackedCompanyFindMany.mockResolvedValue([PHOENIX_ROW]);
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp-elinor",
      employer: LEUMI,
      proposals: [proposal("תחרות דיגיטלית מול מגדל")],
    });
    expect(out).toMatchObject({ created: 1, merged: 0, refused: 1 });
  });

  /** Two executives at ONE employer are the case sharing was designed for. */
  it("lets two people at the same employer share an axis", async () => {
    axisFindMany.mockResolvedValue([ownedAxis("ax-erez", "אימוץ מוצרי B2C מענפים אחרים", "tc-hapoalim")]);
    trackedCompanyFindMany.mockResolvedValue([HAPOALIM_ROW]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-erez"]]));
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp-pazit",
      employer: HAPOALIM,
      proposals: [proposal("חידושים צרכניים לאימוץ מבנקים בעולם")],
    });
    expect(out).toMatchObject({ created: 0, merged: 1, refused: 0 });
    expect(out.mergeRefused).toEqual([]);
  });

  /**
   * The saving that WAS real: two banks share most of their competitor list, so a genuine
   * peer merge still happens and the shared AxisMatch is still computed once.
   */
  it("lets two banks share an axis", async () => {
    axisFindMany.mockResolvedValue([ownedAxis("ax-erez", "אימוץ מוצרי B2C מענפים אחרים", "tc-hapoalim")]);
    trackedCompanyFindMany.mockResolvedValue([HAPOALIM_ROW]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-erez"]]));
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp-elinor",
      employer: LEUMI,
      proposals: [proposal("חידושים צרכניים לאימוץ מבנקים בעולם")],
    });
    expect(out).toMatchObject({ created: 0, merged: 1 });
    expect(out.mergeRefused).toEqual([]);
  });

  /**
   * Level 1 is exempt, and not as a favour: RadarAxis is unique on [orgId, key], so for a
   * label whose canonical key already exists there is no "create" to fall back to.
   */
  it("still merges an identical canonical key across sectors", async () => {
    axisFindMany.mockResolvedValue([ownedAxis("ax-gil", "בנקאות פתוחה", "tc-phoenix")]);
    trackedCompanyFindMany.mockResolvedValue([PHOENIX_ROW]);
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp-elinor",
      employer: LEUMI,
      proposals: [proposal("פתוחה בנקאות")],
    });
    expect(axisCreate).not.toHaveBeenCalled();
    expect(out).toMatchObject({ merged: 1, refused: 0 });
  });

  /** An axis whose subscribers were detached carries nobody's competitive set. */
  it("allows a merge into an axis with no subscribers left", async () => {
    axisFindMany.mockResolvedValue([ownedAxis("ax-orphan", "אימוץ מוצרי B2C מענפים אחרים", null)]);
    trackedCompanyFindMany.mockResolvedValue([]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-orphan"]]));
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp-elinor",
      employer: LEUMI,
      proposals: [proposal("חידושים צרכניים לאימוץ מבנקים בעולם")],
    });
    expect(out).toMatchObject({ merged: 1, refused: 0 });
  });
  /**
   * A COMPANY_MONITOR axis carries ONE query — the employer's name — so folding a role
   * axis into it would hand the person their own company's press instead of their
   * subject. The axis row owns the queries, which is the same mechanism that put
   * insurance searches on a bank VP; this is the other road to it.
   */
  it("never folds a proposal into a COMPANY_MONITOR axis, however alike the labels", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-mon", key: "company:tc-phoenix", label: "מהלכים של הפניקס", kind: "COMPANY_MONITOR", people: [] },
    ]);
    // Even if the model were to name it, membership decides — not the model.
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-mon"]]));
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp-gil",
      employer: { employerId: "tc-phoenix", names: ["The Phoenix Holdings"], namedCompetitors: ["Harel / הראל"] },
      proposals: [proposal("מהלכים של הפניקס")],
    });
    expect(out).toMatchObject({ created: 1, merged: 0 });
    expect(out.mergeRefused[0].reason).toContain("company_monitor");
  });

  /** The model must not even be offered a monitor axis as a merge target. */
  it("keeps monitor axes out of the question the model is asked", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-mon", key: "company:tc-phoenix", label: "מהלכים של הפניקס", kind: "COMPANY_MONITOR", people: [] },
      ownedAxis("ax-role", "אימוץ מוצרי B2C מענפים אחרים", "tc-hapoalim"),
    ]);
    trackedCompanyFindMany.mockResolvedValue([HAPOALIM_ROW]);
    await attachAxes({
      orgId: "org1",
      personProfileId: "pp-erez",
      employer: HAPOALIM,
      proposals: [proposal("נושא חדש לגמרי")],
    });
    expect(resolveMergeQuestions.mock.calls[0][0].map((e: { id: string }) => e.id)).toEqual(["ax-role"]);
  });
});

/**
 * Layer 1: the shared industry net. One RadarAxis per (org × industry canonical), so N
 * employers in the same industry pay for one set of queries instead of N. Mirrors
 * ensureCompanyMonitorAxis's structural-key upsert, but ALSO writes the PersonAxis link —
 * a company monitor has no per-person subscriber to attach, an industry net does.
 */
describe("ensureIndustryAxis", () => {
  it("creates one shared axis and subscribes the person: agenda false, weight 0.5, source INDUSTRY", async () => {
    axisFindUnique.mockResolvedValue(null);
    axisCreate.mockResolvedValueOnce({ id: "ax-industry", key: industryKey("בנקאות"), label: "ענף: בנקאות" });

    const outcome = await ensureIndustryAxis({
      orgId: "org1",
      personProfileId: "pp1",
      industry: { canonical: "בנקאות", queries: ["ריבית בנק ישראל", "רגולציה בנקאית 2026"] },
    });

    expect(outcome).toBe("created");
    expect(axisCreate.mock.calls[0][0].data).toMatchObject({
      orgId: "org1",
      key: industryKey("בנקאות"),
      label: "ענף: בנקאות",
      kind: "INDUSTRY",
      searchQueries: ["ריבית בנק ישראל", "רגולציה בנקאית 2026"],
    });
    expect(personAxisUpsert.mock.calls[0][0].create).toMatchObject({
      personProfileId: "pp1",
      axisId: "ax-industry",
      source: "INDUSTRY",
      agenda: false,
      weight: 0.5,
      rationale: "שאילתות ענף משותפות — בנקאות",
    });
  });

  it("caps searchQueries at MAX_INDUSTRY_QUERIES", async () => {
    axisFindUnique.mockResolvedValue(null);
    await ensureIndustryAxis({
      orgId: "org1",
      personProfileId: "pp1",
      industry: { canonical: "בנקאות", queries: ["a", "b", "c", "d", "e", "f", "g"] },
    });
    expect(axisCreate.mock.calls[0][0].data.searchQueries).toHaveLength(MAX_INDUSTRY_QUERIES);
  });

  /** The point of the net: a second employer's person joins the existing axis, not a duplicate. */
  it("attaches to the existing axis on a second call — idempotent, no duplicate axis", async () => {
    axisFindUnique.mockResolvedValue({ id: "ax-industry" });

    const outcome = await ensureIndustryAxis({
      orgId: "org1",
      personProfileId: "pp2",
      industry: { canonical: "בנקאות", queries: ["ריבית בנק ישראל"] },
    });

    expect(outcome).toBe("attached");
    expect(axisCreate).not.toHaveBeenCalled();
    expect(personAxisUpsert.mock.calls[0][0].where.personProfileId_axisId).toEqual({
      personProfileId: "pp2",
      axisId: "ax-industry",
    });
  });

  /** Re-running for the same person must not clobber a weight the learning loop moved. */
  it("does not touch weight on a repeat call for the same person", async () => {
    axisFindUnique.mockResolvedValue({ id: "ax-industry" });
    await ensureIndustryAxis({
      orgId: "org1",
      personProfileId: "pp1",
      industry: { canonical: "בנקאות", queries: ["ריבית בנק ישראל"] },
    });
    expect(personAxisUpsert.mock.calls[0][0].update).toEqual({});
  });

  /** Two spellings of the same industry land on the same key — the sharing mechanism. */
  it("looks the axis up by the same canonical key industryKey() produces", async () => {
    axisFindUnique.mockResolvedValue({ id: "ax-industry" });
    await ensureIndustryAxis({
      orgId: "org1",
      personProfileId: "pp3",
      industry: { canonical: "Israeli Banking / בנקאות ישראל", queries: ["q"] },
    });
    expect(axisFindUnique.mock.calls[0][0].where.orgId_key).toEqual({
      orgId: "org1",
      key: industryKey("בנקאות ישראל / Israeli banking"),
    });
  });
});

/**
 * The merge catalog excludes INDUSTRY exactly as it excludes COMPANY_MONITOR: a net is
 * not a subject, and a ROLE_COMPANY proposal can never merge into it, however alike the
 * labels look. Same failure mode as the COMPANY_MONITOR tests above, on the other kind.
 */
describe("attachAxes excludes INDUSTRY from the merge catalog", () => {
  it("never folds a proposal into an INDUSTRY axis, however alike the labels", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-ind", key: industryKey("בנקאות"), label: "ענף: בנקאות", kind: "INDUSTRY", people: [] },
    ]);
    resolveMergeQuestions.mockResolvedValue(new Map([[0, "ax-ind"]]));

    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1",
      employer: HAPOALIM,
      proposals: [proposal("בנקאות")],
    });

    expect(out).toMatchObject({ created: 1, merged: 0, refused: 1 });
    expect(out.mergeRefused[0].reason).toContain("industry_net");
  });

  /** The model must not even be offered an INDUSTRY axis as a merge target. */
  it("keeps INDUSTRY axes out of the question the model is asked, same as COMPANY_MONITOR", async () => {
    axisFindMany.mockResolvedValue([
      { id: "ax-ind", key: industryKey("בנקאות"), label: "ענף: בנקאות", kind: "INDUSTRY", people: [] },
      ownedAxis("ax-role", "אימוץ מוצרי B2C מענפים אחרים", "tc-hapoalim"),
    ]);
    trackedCompanyFindMany.mockResolvedValue([HAPOALIM_ROW]);

    await attachAxes({
      orgId: "org1",
      personProfileId: "pp-erez",
      employer: HAPOALIM,
      proposals: [proposal("נושא חדש לגמרי")],
    });

    expect(resolveMergeQuestions.mock.calls[0][0].map((e: { id: string }) => e.id)).toEqual(["ax-role"]);
  });

  it("exact-key hit still exempt: an identical INDUSTRY key label still cannot become a merge target", async () => {
    // RadarAxis is unique on [orgId, key] — but a ROLE_COMPANY proposal normalises to a
    // DIFFERENT key ("בנקאות") than the industry axis's namespaced key
    // ("industry:בנקאות"), so the two can never collide at level 1 either.
    axisFindMany.mockResolvedValue([
      { id: "ax-ind", key: industryKey("בנקאות"), label: "ענף: בנקאות", kind: "INDUSTRY", people: [] },
    ]);
    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1",
      employer: HAPOALIM,
      proposals: [proposal("בנקאות")],
    });
    expect(axisCreate).toHaveBeenCalled();
    expect(out.created).toBe(1);
  });
});

/**
 * The ceiling exemption: an INDUSTRY axis is a shared net, not a subject, so it must not
 * spend the org's MAX_AXES_PER_ORG budget. Verified in code on 2026-08-26: `attachAxes`
 * counted ALL active axes regardless of kind, so a growing industry net would eventually
 * crowd out the org's own subject axes.
 *
 * COMPANY_MONITOR is deliberately NOT exempted here — it still counts. That is
 * pre-existing behaviour (one axis per tracked company) and out of this task's scope;
 * flagged to the user rather than changed in passing.
 */
describe("attachAxes ceiling exemption for INDUSTRY", () => {
  it("creates past MAX_AXES_PER_ORG - 1 ROLE_COMPANY axes when the rest of the room is INDUSTRY nets", async () => {
    axisFindMany.mockResolvedValue([
      ...Array.from({ length: MAX_AXES_PER_ORG - 1 }, (_, i) => ({
        id: `r${i}`, key: `k${i}`, label: `נושא ייחודי ${i}`, kind: "ROLE_COMPANY",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `ind${i}`, key: `industry:k${i}`, label: `ענף ${i}`, kind: "INDUSTRY", people: [],
      })),
    ]);

    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1",
      employer: HAPOALIM,
      proposals: [proposal("אנרגיה מתחדשת")],
    });

    expect(axisCreate).toHaveBeenCalled();
    expect(out.skipped).toHaveLength(0);
  });

  /** The companion case: MAX_AXES_PER_ORG ROLE_COMPANY axes still refuses, INDUSTRY rows or not. */
  it("still refuses at MAX_AXES_PER_ORG ROLE_COMPANY axes, regardless of how many INDUSTRY axes exist", async () => {
    axisFindMany.mockResolvedValue([
      ...Array.from({ length: MAX_AXES_PER_ORG }, (_, i) => ({
        id: `r${i}`, key: `k${i}`, label: `נושא ייחודי ${i}`, kind: "ROLE_COMPANY",
      })),
      { id: "ind0", key: "industry:k0", label: "ענף 0", kind: "INDUSTRY", people: [] },
    ]);

    const out = await attachAxes({
      orgId: "org1",
      personProfileId: "pp1",
      employer: HAPOALIM,
      proposals: [proposal("אנרגיה מתחדשת")],
    });

    expect(axisCreate).not.toHaveBeenCalled();
    expect(out.skipped[0].reason).toBe("org_ceiling");
  });
});
