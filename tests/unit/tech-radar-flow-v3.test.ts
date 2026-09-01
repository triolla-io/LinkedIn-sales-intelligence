import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Task 9 — the wiring of the v3 flow.
 *
 * Five modules were built and tested in isolation (source-packs, fetch-sources, triage
 * tagging, person-tags, match-floors, chooser, dropouts) and until this task nothing read
 * them. These tests are about the SEAMS, and each one names the measured failure it exists
 * to prevent:
 *
 *   - the pool comes from SOURCE PACKS, not from axis `searchQueries`. On 2026-08-31
 *     serper/serpapi/tavily were all at 0 remaining for the month, which is why Bank
 *     Hapoalim's research ran on five news items.
 *   - the narrow named channel survives, and its queries are built in CODE from names.
 *     "The LLM's free queries produced the Philippines" is the spec's own verdict.
 *   - the floors run BEFORE any LLM call. Yesterday's scan cost ~$1 because every
 *     candidate reached a judge.
 *   - the chooser is ONE call per person, and the Opus veto is untouched and last.
 *   - every drop carries a stable reason and lands in the report. The two incidents:
 *     2026-08-27 (100% of a provider's results vanished silently) and 2026-08-24
 *     ("0 נמצאו" that was 25 people silently title-filtered).
 *
 * NOTHING here touches the network, prisma or an LLM: prisma, fetchSourcePack,
 * fetchPoolNews, triageAll, chooseForPerson and judgeAndDraft are all mocked.
 */

// ─── prisma ──────────────────────────────────────────────────────────────────
const axisFindMany = vi.fn();
const profileFindMany = vi.fn();
const scanRunCreate = vi.fn();
const scanRunUpdate = vi.fn();
const scanRunFindUnique = vi.fn();
const axisMatchUpsert = vi.fn();
const techItemUpdate = vi.fn();
const dropoutCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: { findMany: (...a: unknown[]) => axisFindMany(...a) },
    personProfile: { findMany: (...a: unknown[]) => profileFindMany(...a) },
    radarScanRun: {
      create: (...a: unknown[]) => scanRunCreate(...a),
      update: (...a: unknown[]) => scanRunUpdate(...a),
      findUnique: (...a: unknown[]) => scanRunFindUnique(...a),
    },
    axisMatch: { upsert: (...a: unknown[]) => axisMatchUpsert(...a) },
    techItem: { update: (...a: unknown[]) => techItemUpdate(...a) },
    radarDropout: { createMany: (...a: unknown[]) => dropoutCreateMany(...a) },
  },
}));

// ─── the intake halves ───────────────────────────────────────────────────────
const resolvePacksForOrg = vi.fn();
vi.mock("@/lib/tech-radar/source-packs", async () => {
  const actual = await import("@/lib/tech-radar/source-packs");
  return { ...actual, resolvePacksForOrg: (...a: unknown[]) => resolvePacksForOrg(...a) };
});

const fetchSourcePack = vi.fn();
vi.mock("@/lib/tech-radar/fetch-sources", async () => {
  const actual = await import("@/lib/tech-radar/fetch-sources");
  return { ...actual, fetchSourcePack: (...a: unknown[]) => fetchSourcePack(...a) };
});

const fetchPoolNews = vi.fn();
vi.mock("@/lib/tech-radar/fetch-pool-news", () => ({
  fetchPoolNews: (...a: unknown[]) => fetchPoolNews(...a),
  SCAN_WINDOW_DAYS: 30,
}));

// ─── the paid stages ─────────────────────────────────────────────────────────
const triageAll = vi.fn();
vi.mock("@/lib/tech-radar/triage", () => ({ triageAll: (...a: unknown[]) => triageAll(...a) }));

const chooseForPerson = vi.fn();
vi.mock("@/lib/tech-radar/chooser", async () => {
  const actual = await import("@/lib/tech-radar/chooser");
  return { ...actual, chooseForPerson: (...a: unknown[]) => chooseForPerson(...a) };
});

const judgeAndDraft = vi.fn();
vi.mock("@/lib/tech-radar/judge-and-draft", () => ({ judgeAndDraft: (...a: unknown[]) => judgeAndDraft(...a) }));

const synthesizeItem = vi.fn();
vi.mock("@/lib/tech-radar/item", async () => {
  const actual = await import("@/lib/tech-radar/item");
  return { ...actual, synthesizeItem: (...a: unknown[]) => synthesizeItem(...a) };
});

const readPage = vi.fn();
vi.mock("@/lib/research/read-page", () => ({
  readPage: (...a: unknown[]) => readPage(...a),
  readPages: async () => [],
  MAX_PAGE_CHARS: 8000,
}));

const upsertTechItem = vi.fn();
vi.mock("@/lib/tech-radar/persist", () => ({ upsertTechItem: (...a: unknown[]) => upsertTechItem(...a) }));

const { personScan, buildNamedQueries, poolQueryCount } = await import("@/lib/tech-radar/person-scan");

// ─── fixtures ────────────────────────────────────────────────────────────────

/** Three tags is enough to exercise every tier; the live pack carries ~50. */
const PACK = {
  industryKey: "banking finance",
  label: "בנקאות ופיננסים",
  sources: [
    { host: "globes.co.il", name: "גלובס", lang: "he", scope: "il", enabled: true },
    { host: "finextra.com", name: "Finextra", lang: "en", scope: "global", enabled: true },
  ],
  taxonomy: [
    { tag: "אשראי-צרכני", label: "אשראי צרכני ומשקי בית" },
    { tag: "שוקי-הון", label: "שוקי הון ומסחר" },
    { tag: "תשלומים", label: "תשלומים" },
  ],
  globalPlayers: ["JPMorgan"],
};

const RETAIL_PACK = {
  industryKey: "retail",
  label: "קמעונאות",
  sources: [{ host: "themarker.com", name: "דה-מרקר", lang: "he", scope: "il", enabled: true }],
  taxonomy: [{ tag: "חנויות", label: "חנויות פיזיות" }],
  globalPlayers: ["Zara"],
};

function fresh(daysAgo = 3): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

/**
 * Pazit: Head of Retail Banking. The person every measured failure was measured on —
 * Israeli B2C audience, capital markets explicitly NOT hers, One Zero watched by name.
 */
function pazit(overrides: Record<string, unknown> = {}) {
  return {
    id: "pp-pazit",
    roleLens: "בנקאות קמעונאית",
    personalNotes: null,
    audience: { type: ["B2C"], who: "משקי בית", geography: "ישראל" },
    scope: { owns: ["אשראי צרכני"], notOwns: ["שוקי הון"] },
    employerTrackedCompanyId: "tc-poalim",
    contact: {
      id: "ct-pazit",
      ownerId: "u1",
      fullName: "פזית",
      hebrewFirstName: "פזית",
      currentTitle: "ראשת בנקאות קמעונאית",
      currentCompany: "בנק הפועלים",
      experience: null,
    },
    axes: [
      {
        axisId: "ax-industry",
        personProfileId: "pp-pazit",
        source: "INDUSTRY",
        mutedAt: null,
        agenda: false,
        weight: 1,
        rationale: "רשת הענף",
        evidence: null,
        axis: { id: "ax-industry", label: "ענף: בנקאות ישראל", kind: "INDUSTRY" },
      },
      {
        axisId: "ax-credit",
        personProfileId: "pp-pazit",
        source: "ROLE_COMPANY",
        mutedAt: null,
        agenda: true,
        weight: 1,
        rationale: "היא חתומה על האשראי הצרכני",
        evidence: { personDecision: "תמחור האשראי הצרכני", layerEvidence: { layer: 3, quote: "q", dateIso: fresh(10) } },
        axis: { id: "ax-credit", label: "אשראי צרכני", kind: "ROLE_COMPANY" },
      },
      {
        axisId: "ax-onezero",
        personProfileId: "pp-pazit",
        source: "PERSON_ENTITY",
        mutedAt: null,
        agenda: false,
        weight: 1,
        rationale: "מתחרה ישיר",
        evidence: { aliases: ["וואן זירו"] },
        axis: { id: "ax-onezero", label: "One Zero", kind: "PERSON_ENTITY" },
      },
    ],
    ...overrides,
  };
}

/** Erez: CITO. INTERNAL audience with no geography — homeMarket() returns null for him,
 *  so the geography gate is SKIPPED and the report has to SAY so. */
function erez(overrides: Record<string, unknown> = {}) {
  return {
    id: "pp-erez",
    roleLens: "טכנולוגיה",
    personalNotes: null,
    audience: { type: ["INTERNAL"], who: "יחידות הבנק", geography: "" },
    scope: { owns: ["ליבה בנקאית"], notOwns: [] },
    employerTrackedCompanyId: "tc-poalim",
    contact: {
      id: "ct-erez",
      ownerId: "u1",
      fullName: "ארז",
      hebrewFirstName: "ארז",
      currentTitle: "CITO",
      currentCompany: "בנק הפועלים",
      experience: null,
    },
    axes: [
      {
        axisId: "ax-industry",
        personProfileId: "pp-erez",
        source: "INDUSTRY",
        mutedAt: null,
        agenda: false,
        weight: 1,
        rationale: "רשת הענף",
        evidence: null,
        axis: { id: "ax-industry", label: "ענף: בנקאות ישראל", kind: "INDUSTRY" },
      },
      {
        axisId: "ax-payments",
        personProfileId: "pp-erez",
        source: "ROLE_COMPANY",
        mutedAt: null,
        agenda: false,
        weight: 1,
        rationale: "הוא מחזיק בתשלומים",
        evidence: null,
        axis: { id: "ax-payments", label: "תשלומים", kind: "ROLE_COMPANY" },
      },
    ],
    ...overrides,
  };
}

/**
 * The H&M scenario from the spec: a person in a DIFFERENT industry, so the run has to
 * resolve two packs and keep their vocabularies apart.
 */
function retailer(overrides: Record<string, unknown> = {}) {
  return {
    id: "pp-retail",
    roleLens: "קמעונאות",
    personalNotes: null,
    audience: { type: ["B2C"], who: "קונים", geography: "ישראל" },
    scope: { owns: ["חנויות"], notOwns: [] },
    employerTrackedCompanyId: null,
    contact: {
      id: "ct-retail",
      ownerId: "u1",
      fullName: "דנה",
      hebrewFirstName: "דנה",
      currentTitle: "מנכ\"לית",
      currentCompany: "H&M ישראל",
      experience: null,
    },
    axes: [
      {
        axisId: "ax-retail",
        personProfileId: "pp-retail",
        source: "INDUSTRY",
        mutedAt: null,
        agenda: false,
        weight: 1,
        rationale: "רשת הענף",
        evidence: null,
        axis: { id: "ax-retail", label: "ענף: קמעונאות", kind: "INDUSTRY" },
      },
    ],
    ...overrides,
  };
}

/** The axes rows section 1 reads. Derived from the profiles so the two can never disagree. */
type ProfileFixture = {
  id: string;
  contact: { id: string };
  axes: { axisId: string; mutedAt: unknown; evidence: unknown; axis: { id: string; label: string; kind: string } }[];
};

function axesFor(profiles: ProfileFixture[]) {
  const byId = new Map<string, { id: string; label: string; kind: string; weight: number; people: unknown[] }>();
  for (const p of profiles) {
    for (const link of p.axes) {
      const row = byId.get(link.axisId) ?? {
        id: link.axis.id,
        label: link.axis.label,
        kind: link.axis.kind,
        weight: 1,
        people: [],
      };
      row.people.push({
        mutedAt: link.mutedAt,
        evidence: link.evidence,
        personProfile: { id: p.id, contactId: p.contact.id },
      });
      byId.set(link.axisId, row);
    }
  }
  return [...byId.values()];
}

function packItem(over: Record<string, unknown> = {}) {
  return {
    title: "בנק ישראל פרסם הוראה חדשה על אשראי צרכני",
    url: "https://www.globes.co.il/news/article.aspx?did=1",
    snippet: "הפיקוח על הבנקים",
    publishedAt: fresh(),
    sourceHost: "globes.co.il",
    ...over,
  };
}

const PER_SOURCE = [
  { host: "globes.co.il", name: "גלובס", items: 1, via: "rss", feedUrl: "https://www.globes.co.il/rss" },
  { host: "finextra.com", name: "Finextra", items: 0, via: "rss", feedUrl: "https://www.finextra.com/rss", error: "RSS: empty or non-2xx" },
];

function verdict(url: string, over: Record<string, unknown> = {}) {
  return {
    url,
    shareworthy: 0.9,
    stature: 0.9,
    kind: "big_news",
    publisher: "globes.co.il",
    staleness: false,
    israelRelevant: true,
    categories: ["credit"],
    industryTags: ["אשראי-צרכני"],
    technology: null,
    vendor: null,
    ...over,
  };
}

function lastReport(): Record<string, unknown> {
  const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
  return update.data.report as Record<string, unknown>;
}

beforeEach(() => {
  for (const m of [
    axisFindMany, profileFindMany, scanRunCreate, scanRunUpdate, scanRunFindUnique, axisMatchUpsert,
    techItemUpdate, dropoutCreateMany, resolvePacksForOrg, fetchSourcePack, fetchPoolNews, triageAll,
    chooseForPerson, judgeAndDraft, synthesizeItem, readPage, upsertTechItem,
  ]) m.mockReset();

  scanRunCreate.mockResolvedValue({ id: "run1" });
  scanRunUpdate.mockResolvedValue({});
  axisMatchUpsert.mockResolvedValue({ id: "am1" });
  techItemUpdate.mockResolvedValue({});
  dropoutCreateMany.mockResolvedValue({ count: 0 });
  resolvePacksForOrg.mockResolvedValue({
    packs: [PACK], industries: [{ industryKey: "banking finance", labels: ["ענף: בנקאות ישראל"], axisIds: ["ax-industry"], people: 2 }],
    unresolved: [], noSubscribers: [], unkeyed: [],
  });
  fetchSourcePack.mockResolvedValue({ items: [packItem()], perSource: PER_SOURCE });
  fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 0, cachedQueries: 0, quotaLikely: false, providerStats: [] });
  triageAll.mockResolvedValue([]);
  readPage.mockResolvedValue(null);
  synthesizeItem.mockImplementation(async (input: { articles: { url: string; title: string }[] }) => ({
    title: input.articles[0].title,
    summary: "סיכום",
    technology: null,
    vendor: null,
    categories: [],
    sources: [{ url: input.articles[0].url, title: input.articles[0].title, publishedAt: fresh() }],
    publishedAt: fresh(),
    thin: true,
    shareworthy: 0.9,
    stature: 0.9,
    kind: "big_news",
  }));
  upsertTechItem.mockResolvedValue("item-1");
  chooseForPerson.mockResolvedValue({ picks: [], noneReason: "אין כלום", outcome: "none" });
  judgeAndDraft.mockResolvedValue({
    candidates: 0, ranked: 0, vetoed: 0, vetoFaults: 0, drafted: 0, dropReasons: {}, unknownSourceHosts: [],
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("the pool comes from source packs", () => {
  it("pulls every resolved pack and never builds a query pool from axis searchQueries", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);

    await personScan("org1");

    expect(resolvePacksForOrg).toHaveBeenCalledWith("org1");
    expect(fetchSourcePack).toHaveBeenCalledTimes(1);
    expect((fetchSourcePack.mock.calls[0][0] as { industryKey: string }).industryKey).toBe("banking finance");

    // The pack item reached triage.
    const triaged = (triageAll.mock.calls[0][0] as { url: string }[]).map((i) => i.url);
    expect(triaged).toContain("https://www.globes.co.il/news/article.aspx?did=1");
  });

  it("pulls one pack per industry and triages each group with ITS OWN taxonomy, never a merged union", async () => {
    resolvePacksForOrg.mockResolvedValue({
      packs: [PACK, RETAIL_PACK],
      industries: [
        { industryKey: "banking finance", labels: ["ענף: בנקאות ישראל"], axisIds: ["ax-industry"], people: 1 },
        { industryKey: "retail", labels: ["ענף: קמעונאות"], axisIds: ["ax-retail"], people: 1 },
      ],
      unresolved: [], noSubscribers: [], unkeyed: [],
    });
    fetchSourcePack.mockImplementation(async (pack: { industryKey: string }) =>
      pack.industryKey === "banking finance"
        ? { items: [packItem()], perSource: PER_SOURCE }
        : { items: [packItem({ url: "https://www.themarker.com/1", title: "חנויות", sourceHost: "themarker.com" })], perSource: [] }
    );
    // A retail person, or the retail pack's items have nobody to be measured against and
    // die at floor 0 on `industry_mismatch` — which is itself the rule working.
    const people = [pazit(), retailer()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);

    await personScan("org1");

    expect(fetchSourcePack).toHaveBeenCalledTimes(2);
    // One triage call per industry group, each carrying only its own vocabulary. The
    // 2026-08-26 axis-merge leak (Phoenix's insurance rivals in Bank Leumi's searches) is
    // exactly what a merged taxonomy would be, one layer down.
    const taxonomies = triageAll.mock.calls.map((c) => (c[1] as { tag: string }[] | undefined)?.map((t) => t.tag));
    expect(taxonomies).toContainEqual(["אשראי-צרכני", "שוקי-הון", "תשלומים"]);
    expect(taxonomies).toContainEqual(["חנויות"]);
    // No call may hold tags from two packs at once.
    for (const t of taxonomies ?? []) {
      if (!t) continue;
      const mixed = t.includes("חנויות") && t.includes("אשראי-צרכני");
      expect(mixed).toBe(false);
    }
  });

  it("reports an industry that resolved to NO pack rather than letting it be a quiet zero", async () => {
    resolvePacksForOrg.mockResolvedValue({
      packs: [],
      industries: [{ industryKey: "fashion", labels: ["ענף: אופנה"], axisIds: ["ax-f"], people: 1 }],
      unresolved: [{ industryKey: "fashion", labels: ["ענף: אופנה"], axisIds: ["ax-f"], people: 1, reason: "no_pack" }],
      noSubscribers: [], unkeyed: [],
    });
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);

    await personScan("org1");

    const report = lastReport();
    expect(report.unresolvedIndustries).toEqual([
      expect.objectContaining({ industryKey: "fashion", reason: "no_pack", labels: ["ענף: אופנה"] }),
    ]);
  });
});

describe("the narrow named-query channel", () => {
  it("builds queries deterministically from competitor and employer names only", () => {
    const first = buildNamedQueries([
      { entities: [{ name: "One Zero", aliases: ["וואן זירו"], axisId: "ax-onezero" }], employers: [{ name: "בנק הפועלים", axisIds: ["ax-mon"] }] },
    ]);
    const second = buildNamedQueries([
      { entities: [{ name: "One Zero", aliases: ["וואן זירו"], axisId: "ax-onezero" }], employers: [{ name: "בנק הפועלים", axisIds: ["ax-mon"] }] },
    ]);
    // Deterministic: same input, same queries, same order. No LLM writes any of them.
    expect(first).toEqual(second);
    const queries = first.map((q) => q.query);
    expect(queries).toContain("One Zero");
    expect(queries).toContain("וואן זירו");
    expect(queries).toContain("בנק הפועלים");
    // Attribution survives, so an axis's stats still say what it asked for.
    expect(first.find((q) => q.query === "One Zero")!.companyIds).toEqual(["ax-onezero"]);
  });

  it("runs the named channel alongside the packs, with names and NOT axis searchQueries", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    fetchPoolNews.mockResolvedValue({
      items: [
        {
          title: "One Zero raises",
          url: "https://www.reuters.com/onezero",
          snippet: "s",
          source: "serper",
          publishedAt: fresh(),
          companyIds: ["ax-onezero"],
        },
      ],
      queriesRun: 3, cachedQueries: 0, quotaLikely: false, providerStats: [{ provider: "serper", results: 1, israeliSources: 0 }],
    });

    await personScan("org1");

    expect(fetchPoolNews).toHaveBeenCalledTimes(1);
    const asked = (fetchPoolNews.mock.calls[0][0] as { query: string }[]).map((q) => q.query);
    expect(asked).toContain("One Zero");
    expect(asked).toContain("בנק הפועלים");
    // The v2 backbone is gone: nothing asks for an axis's free-text search query.
    expect(asked).not.toContain("RIN obligations refiners");
    const report = lastReport();
    expect(report.namedQueries).toBe(asked.length);
  });

  it("spends nothing on the named channel when there is no name to ask about", async () => {
    const bare = pazit({ axes: [] });
    const people = [{ ...bare, contact: { ...bare.contact, currentCompany: null } }];
    axisFindMany.mockResolvedValue(axesFor([pazit()]));
    profileFindMany.mockResolvedValue(people);

    await personScan("org1");

    // No entity and no employer — nothing to build a query from, and therefore no paid
    // call. An employer name on its own IS a name and would legitimately buy one query.
    expect(fetchPoolNews).not.toHaveBeenCalled();
  });

  it("poolQueryCount counts the named channel, which is what actually gets billed", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    const out = await poolQueryCount("org1");
    expect(out.uniqueQueries).toBeGreaterThan(0);
    expect(out.axes).toBe(3);
  });
});

describe("the floors run before any LLM call", () => {
  it("drops a foreign-local item at floor 0, so triage is never paid for it", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    fetchSourcePack.mockResolvedValue({
      items: [
        packItem(),
        packItem({
          url: "https://www.finextra.com/philippines",
          title: "A retail bank in the Philippines launched a feature",
          snippet: "Manila",
          sourceHost: "finextra.com",
        }),
      ],
      perSource: PER_SOURCE,
    });

    await personScan("org1");

    const triaged = (triageAll.mock.calls[0][0] as { url: string }[]).map((i) => i.url);
    expect(triaged).toEqual(["https://www.globes.co.il/news/article.aspx?did=1"]);
    const report = lastReport();
    expect((report.floorDrops as Record<string, number>).geography).toBe(1);
  });

  it("drops a notOwns item at floor 0 with its own reason code", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    fetchSourcePack.mockResolvedValue({
      items: [packItem({ url: "https://www.globes.co.il/capital", title: "שוק ההון מגיב להנפקה", snippet: "מסחר" })],
      perSource: PER_SOURCE,
    });

    await personScan("org1");

    expect(triageAll).not.toHaveBeenCalled();
    const report = lastReport();
    expect((report.floorDrops as Record<string, number>).not_owns).toBe(1);
    // And it is EVIDENCE, not just a counter: the row names the person it died for.
    const rows = (dropoutCreateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown>[] }).data;
    expect(rows).toEqual([
      expect.objectContaining({ floor: "not_owns", contactId: "ct-pazit", url: "https://www.globes.co.il/capital" }),
    ]);
  });

  it("keeps floor 1 in code: no per-pair LLM judgement is made for a tag miss", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    // Tagged with a line she does not subscribe to, and no entity in the text.
    triageAll.mockResolvedValue([verdict("https://www.globes.co.il/news/article.aspx?did=1", { industryTags: ["תשלומים"] })]);

    await personScan("org1");

    // One broad tag is not two — she never becomes a candidate, and no chooser call is made.
    expect(chooseForPerson).not.toHaveBeenCalled();
    const report = lastReport();
    expect((report.floorDrops as Record<string, number>).tag_overlap).toBe(1);
  });
});

describe("the chooser and the veto", () => {
  it("calls the chooser exactly ONCE per person, over that person's own candidates", async () => {
    const people = [pazit(), erez()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    fetchSourcePack.mockResolvedValue({
      items: [
        packItem(),
        packItem({ url: "https://www.globes.co.il/pay", title: "רפורמת התשלומים המיידיים", snippet: "העברות" }),
      ],
      perSource: PER_SOURCE,
    });
    triageAll.mockResolvedValue([
      verdict("https://www.globes.co.il/news/article.aspx?did=1", { industryTags: ["אשראי-צרכני"] }),
      verdict("https://www.globes.co.il/pay", { industryTags: ["תשלומים"] }),
    ]);
    upsertTechItem.mockImplementation(async (draft: { sources: { url: string }[] }) =>
      draft.sources[0].url.includes("/pay") ? "item-pay" : "item-credit"
    );

    await personScan("org1");

    expect(chooseForPerson).toHaveBeenCalledTimes(2);
    const byName = new Map(
      chooseForPerson.mock.calls.map((c) => [
        (c[0] as { fullName: string }).fullName,
        (c[1] as { itemId: string }[]).map((x) => x.itemId),
      ])
    );
    // Each person is handed the items THEIR tags reached, and nobody else's.
    expect(byName.get("פזית")).toEqual(["item-credit"]);
    expect(byName.get("ארז")).toEqual(["item-pay"]);
    const report = lastReport();
    expect(report.chooserCalls).toBe(2);
  });

  it("turns a pick into an AxisMatch row and only THEN runs the unchanged Opus veto", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    triageAll.mockResolvedValue([verdict("https://www.globes.co.il/news/article.aspx?did=1")]);
    chooseForPerson.mockResolvedValue({
      picks: [{ itemId: "item-1", why: "זה בדיוק התיק שלה" }],
      outcome: "judged",
    });
    judgeAndDraft.mockResolvedValue({
      candidates: 1, ranked: 1, vetoed: 0, vetoFaults: 0, drafted: 1, dropReasons: {}, unknownSourceHosts: [],
    });

    const report = await personScan("org1");

    // AxisMatch stays the persisted match row: every screen, deriveJourney and radar.judge
    // read it, so the chooser's pick has to land there and nowhere new.
    expect(axisMatchUpsert).toHaveBeenCalledTimes(1);
    const args = axisMatchUpsert.mock.calls[0][0] as {
      where: { axisId_itemId: { axisId: string; itemId: string } };
      create: { rationale: string; score: number };
    };
    expect(args.where.axisId_itemId.itemId).toBe("item-1");
    expect(args.create.rationale).toContain("זה בדיוק התיק שלה");
    expect(args.create.score).toBeGreaterThanOrEqual(0.5);

    // The veto is the LAST gate, and it is judgeAndDraft's, unchanged — one call, orgId only.
    expect(judgeAndDraft).toHaveBeenCalledTimes(1);
    expect(judgeAndDraft).toHaveBeenCalledWith("org1");
    const matchOrder = axisMatchUpsert.mock.invocationCallOrder[0];
    const vetoOrder = judgeAndDraft.mock.invocationCallOrder[0];
    expect(matchOrder).toBeLessThan(vetoOrder);
    expect(report.drafted).toBe(1);
  });

  it("records an unpicked candidate as a chooser drop-out, never as silence", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    triageAll.mockResolvedValue([verdict("https://www.globes.co.il/news/article.aspx?did=1")]);
    chooseForPerson.mockResolvedValue({ picks: [], noneReason: "חלש לשבוע הזה", outcome: "none" });

    await personScan("org1");

    expect(judgeAndDraft).not.toHaveBeenCalled();
    const report = lastReport();
    expect((report.floorDrops as Record<string, number>).chooser).toBe(1);
    const rows = (dropoutCreateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown>[] }).data;
    expect(rows).toEqual([
      expect.objectContaining({ floor: "chooser", contactId: "ct-pazit", reason: expect.stringContaining("חלש") }),
    ]);
  });
});

describe("what the report has to say", () => {
  it("reports per-source counts, including the source that came back broken", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);

    await personScan("org1");

    const report = lastReport();
    expect(report.perSource).toEqual([
      expect.objectContaining({ host: "globes.co.il", items: 1, industryKey: "banking finance" }),
      expect.objectContaining({ host: "finextra.com", items: 0, error: expect.stringContaining("non-2xx") }),
    ]);
    expect(report.sourcePacks).toEqual([
      expect.objectContaining({ industryKey: "banking finance", sources: 2, taxonomyTags: 3, items: 1 }),
    ]);
  });

  it("names every floor's drops and writes them with ONE createMany", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    fetchSourcePack.mockResolvedValue({
      items: [
        packItem(),
        packItem({ url: "https://www.globes.co.il/stale", title: "ישן", publishedAt: fresh(45) }),
        packItem({ url: "https://www.globes.co.il/undated", title: "בלי תאריך", publishedAt: null }),
      ],
      perSource: PER_SOURCE,
    });
    triageAll.mockResolvedValue([
      verdict("https://www.globes.co.il/news/article.aspx?did=1", { shareworthy: 0.1 }),
    ]);

    await personScan("org1");

    const report = lastReport();
    const drops = report.floorDrops as Record<string, number>;
    expect(drops.freshness).toBe(2);
    expect(drops.shareworthy).toBe(1);
    // One write per run — the rows are built pure and capped before they are persisted.
    expect(dropoutCreateMany).toHaveBeenCalledTimes(1);
    const rows = (dropoutCreateMany.mock.calls[0][0] as { data: Record<string, unknown>[] }).data;
    expect(rows.filter((r) => r.floor === "freshness")).toHaveLength(2);
    expect(rows.every((r) => r.runId === "run1")).toBe(true);
    expect(report.dropoutsWritten).toBe(rows.length);
  });

  it("says when the geography gate was SKIPPED, because a skipped gate is not a passed gate", async () => {
    const people = [pazit(), erez()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);

    await personScan("org1");

    const report = lastReport();
    // Erez's audience carries no geography, so homeMarket() is null and nothing filtered
    // his items by market. Pazit's did run.
    expect(report.geoGateSkipped).toEqual(["ארז"]);
    expect(report.peopleScanned).toBe(2);
  });

  it("persists the item's closed-taxonomy tags on the TechItem row", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    triageAll.mockResolvedValue([verdict("https://www.globes.co.il/news/article.aspx?did=1", { industryTags: ["אשראי-צרכני"] })]);

    await personScan("org1");

    expect(techItemUpdate).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { industryTags: ["אשראי-צרכני"] },
    });
  });

  it("writes nothing to industryTags when no taxonomy was offered — absent is not []", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    resolvePacksForOrg.mockResolvedValue({ packs: [], industries: [], unresolved: [], noSubscribers: [], unkeyed: [] });
    fetchPoolNews.mockResolvedValue({
      items: [{ title: "One Zero raises", url: "https://www.reuters.com/onezero", snippet: "One Zero", source: "serper", publishedAt: fresh(), companyIds: ["ax-onezero"] }],
      queriesRun: 3, cachedQueries: 0, quotaLikely: false, providerStats: [],
    });
    // The named channel is triaged WITHOUT a taxonomy, so the verdict carries no
    // industryTags key at all.
    triageAll.mockResolvedValue([
      { url: "https://www.reuters.com/onezero", shareworthy: 0.9, stature: 0.9, kind: "big_news", publisher: "reuters.com", staleness: false, israelRelevant: false, categories: [], technology: null, vendor: null },
    ]);

    await personScan("org1");

    expect(techItemUpdate).not.toHaveBeenCalled();
    // And the entity tier still reaches her — that is the whole point of the narrow channel.
    expect(chooseForPerson).toHaveBeenCalledTimes(1);
    expect((chooseForPerson.mock.calls[0][1] as { tier: string }[])[0].tier).toBe("entity");
  });

  /**
   * A redirect the pool could not unwrap statically resolves at read time, so the url an
   * item is STORED under can differ from the one it was pooled under. Floor 1, the
   * prefilter set and the triage verdicts all join on the POOL url — keying them on the
   * landed one matches nobody and files the drop-out under a url no verdict has a score
   * for, which is a silent zero wearing a plausible face.
   */
  it("keeps matching an item whose page read landed on a different url", async () => {
    const people = [pazit()];
    axisFindMany.mockResolvedValue(axesFor(people));
    profileFindMany.mockResolvedValue(people);
    triageAll.mockResolvedValue([verdict("https://www.globes.co.il/news/article.aspx?did=1", { stature: 0.7 })]);
    readPage.mockResolvedValue({ finalUrl: "https://www.globes.co.il/news/final-slug", title: "t", text: "t" });
    chooseForPerson.mockResolvedValue({ picks: [], noneReason: "לא הפעם", outcome: "none" });

    await personScan("org1");

    // She still reached the chooser: floor 1 found her item.
    expect(chooseForPerson).toHaveBeenCalledTimes(1);
    // And the drop-out row carries the triage scores, which only joins if the row was
    // filed under the pooled url.
    const rows = (dropoutCreateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown>[] }).data;
    expect(rows).toEqual([
      expect.objectContaining({
        floor: "chooser",
        url: "https://www.globes.co.il/news/article.aspx?did=1",
        shareworthy: 0.9,
        stature: 0.7,
      }),
    ]);
  });

  it("closes the run with the new fields even on the earliest exit", async () => {
    axisFindMany.mockResolvedValue([]);
    await personScan("org1");
    const report = lastReport();
    expect(report).toMatchObject({
      perSource: [], sourcePacks: [], unresolvedIndustries: [], namedQueries: 0,
      floorDrops: {}, dropoutsWritten: 0, chooserCalls: 0, chooserPicks: 0,
      geoGateSkipped: [], peopleScanned: 0, floorCandidates: 0,
    });
  });
});
