import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Every personScan run must open a RadarScanRun row before any work and close it with
 * the funnel counters on EVERY exit path — the decisions tab renders this row, and the
 * approvals subline reads it. A path that returns without closing the run shows up in
 * the UI as a scan that never happened.
 *
 * Rewritten for the v3 flow (Phase B): the pool now comes from source PACKS plus the
 * narrow named-query channel, and the per-axis LLM fit is gone. What is being tested here
 * is unchanged — the run row, the freshness gate, the query accounting and the layer
 * counts — but the seams it is tested through moved. The flow's own seams have their own
 * file: tests/unit/tech-radar-flow-v3.test.ts.
 */

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

const fetchPoolNews = vi.fn();
vi.mock("@/lib/tech-radar/fetch-pool-news", () => ({
  fetchPoolNews: (...a: unknown[]) => fetchPoolNews(...a),
  SCAN_WINDOW_DAYS: 30,
}));
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
const triageAll = vi.fn();
vi.mock("@/lib/tech-radar/triage", () => ({ triageAll: (...a: unknown[]) => triageAll(...a) }));
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
const chooseForPerson = vi.fn();
vi.mock("@/lib/tech-radar/chooser", async () => {
  const actual = await import("@/lib/tech-radar/chooser");
  return { ...actual, chooseForPerson: (...a: unknown[]) => chooseForPerson(...a) };
});
const judgeAndDraft = vi.fn();
vi.mock("@/lib/tech-radar/judge-and-draft", () => ({ judgeAndDraft: (...a: unknown[]) => judgeAndDraft(...a) }));
const upsertTechItem = vi.fn();
vi.mock("@/lib/tech-radar/persist", () => ({ upsertTechItem: (...a: unknown[]) => upsertTechItem(...a) }));

const { personScan, poolQueryCount, openScanRun } = await import("@/lib/tech-radar/person-scan");

/**
 * One layer-4 (ROLE_COMPANY) axis with one subscriber. No layer-3 evidence by default, so
 * nothing is implied about a dated fact — the TTL block below sets that explicitly.
 */
function subscribedAxis() {
  return {
    id: "a1",
    label: "חבות RIN",
    kind: "ROLE_COMPANY",
    weight: 1,
    people: [{ mutedAt: null, evidence: null, personProfile: { id: "pp1", contactId: "ct1" } }],
  };
}

/**
 * The PersonProfile row behind that axis.
 *
 * Deliberately a LEGACY-shaped profile: `audience` and `scope` are null, the way every
 * profile built before v3 is. That means floor 0 rejects nothing for him (no industry pack,
 * no notOwns, and `homeMarket()` returns null so the geography gate is SKIPPED and the
 * report says so) — which is what keeps this file about the run row rather than about the
 * floors.
 */
function subscriber() {
  return {
    id: "pp1",
    roleLens: "CEO",
    personalNotes: null,
    audience: null,
    scope: null,
    employerTrackedCompanyId: null,
    contact: {
      id: "ct1", ownerId: "u1", fullName: "Avigal", hebrewFirstName: null,
      currentTitle: "CEO", currentCompany: "Delek", experience: null,
    },
    axes: [
      {
        axisId: "a1",
        personProfileId: "pp1",
        source: "ROLE_COMPANY",
        mutedAt: null,
        agenda: false,
        weight: 1,
        rationale: "הוא מחזיק בהחלטת התפוקה",
        evidence: null,
        axis: { id: "a1", label: "חבות RIN", kind: "ROLE_COMPANY" },
      },
    ],
  };
}

const NO_PACKS = { packs: [], industries: [], unresolved: [], noSubscribers: [], unkeyed: [] };

function packedItem(over: Record<string, unknown> = {}) {
  return {
    title: "t",
    url: "https://news.com/1",
    snippet: "s",
    publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    sourceHost: "news.com",
    ...over,
  };
}

beforeEach(() => {
  for (const m of [
    axisFindMany, profileFindMany, scanRunCreate, scanRunUpdate, scanRunFindUnique, axisMatchUpsert,
    techItemUpdate, dropoutCreateMany, fetchPoolNews, resolvePacksForOrg, fetchSourcePack, triageAll,
    synthesizeItem, readPage, chooseForPerson, judgeAndDraft, upsertTechItem,
  ]) m.mockReset();
  scanRunCreate.mockResolvedValue({ id: "run1" });
  scanRunUpdate.mockResolvedValue({});
  axisMatchUpsert.mockResolvedValue({ id: "am1" });
  dropoutCreateMany.mockResolvedValue({ count: 0 });
  profileFindMany.mockResolvedValue([subscriber()]);
  resolvePacksForOrg.mockResolvedValue(NO_PACKS);
  fetchSourcePack.mockResolvedValue({ items: [], perSource: [] });
  fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 0, cachedQueries: 0, quotaLikely: false, providerStats: [] });
  chooseForPerson.mockResolvedValue({ picks: [], noneReason: "אין", outcome: "none" });
});

/**
 * 2026-08-26 incident: an Inngest retry re-ran personScan from the top four times because
 * the function opened a brand-new RadarScanRun row on every attempt. openScanRun is the
 * fix's other half from lib/tech-radar/person-scan.ts: given the row id the retry is
 * already writing, it resumes that row instead of minting a new one — but only while the
 * row is still open. A retry that lands after the row was already closed (or whose id no
 * longer exists) must never write into a finished run's funnel, so it opens a fresh one.
 */
describe("openScanRun", () => {
  it("creates a new row when no runId is given", async () => {
    scanRunCreate.mockResolvedValue({ id: "new-run" });
    const run = await openScanRun("org1");
    expect(run).toEqual({ id: "new-run" });
    expect(scanRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org1" }) })
    );
    expect(scanRunFindUnique).not.toHaveBeenCalled();
  });

  it("resumes an existing, unfinished run and creates nothing", async () => {
    scanRunFindUnique.mockResolvedValue({ id: "run-open", finishedAt: null });
    const run = await openScanRun("org1", "run-open");
    expect(run).toEqual({ id: "run-open" });
    expect(scanRunCreate).not.toHaveBeenCalled();
  });

  it("opens a NEW row when the given runId already finished", async () => {
    scanRunFindUnique.mockResolvedValue({ id: "run-done", finishedAt: new Date() });
    scanRunCreate.mockResolvedValue({ id: "run-new" });
    const run = await openScanRun("org1", "run-done");
    expect(run).toEqual({ id: "run-new" });
    expect(scanRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org1" }) })
    );
  });

  it("opens a new row when the given runId does not exist", async () => {
    scanRunFindUnique.mockResolvedValue(null);
    scanRunCreate.mockResolvedValue({ id: "run-new" });
    const run = await openScanRun("org1", "does-not-exist");
    expect(run).toEqual({ id: "run-new" });
    expect(scanRunCreate).toHaveBeenCalled();
  });
});

describe("personScan scan-run accounting", () => {
  it("closes the run even on the earliest exit (no subscribed axes)", async () => {
    axisFindMany.mockResolvedValue([]);
    await personScan("org1");
    expect(scanRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org1" }) })
    );
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { where: unknown; data: Record<string, unknown> };
    expect(update.where).toEqual({ id: "run1" });
    expect(update.data.finishedAt).toBeInstanceOf(Date);
  });

  it("closes an exhausted-quota run with its counters, not silence", async () => {
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 4, quotaLikely: true, cachedQueries: 0, providerStats: [] });
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ scanned: 0, drafts: 0 });
    expect((update.data.report as { quotaExhausted: boolean }).quotaExhausted).toBe(true);
  });

  it("records the funnel: seen items that triage rejected count as scanned, not topical", async () => {
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    fetchSourcePack.mockResolvedValue({
      items: [packedItem()],
      perSource: [{ host: "news.com", name: "news", items: 1, via: "rss", feedUrl: "https://news.com/rss" }],
    });
    resolvePacksForOrg.mockResolvedValue({
      ...NO_PACKS,
      packs: [{ industryKey: "banking finance", sources: [], taxonomy: [{ tag: "x", label: "x" }] }],
    });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.2, stature: 0.1, kind: "other", staleness: false, israelRelevant: false, publisher: null, categories: [], vendor: null, technology: null },
    ]);
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ scanned: 1, topical: 0, important: 0, connected: 0, drafts: 0 });
    expect(update.data.finishedAt).toBeInstanceOf(Date);
  });

  it("gates the pool by freshness before anything reaches triage, and names both drop reasons", async () => {
    const freshDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const staleDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    fetchSourcePack.mockResolvedValue({
      items: [
        packedItem({ title: "fresh", url: "https://news.com/fresh", publishedAt: freshDate }),
        packedItem({ title: "undated", url: "https://news.com/undated", publishedAt: null }),
        packedItem({ title: "stale", url: "https://news.com/stale", publishedAt: staleDate }),
      ],
      perSource: [],
    });
    resolvePacksForOrg.mockResolvedValue({ ...NO_PACKS, packs: [{ industryKey: "k", sources: [], taxonomy: [] }] });
    triageAll.mockResolvedValue([
      { url: "https://news.com/fresh", shareworthy: 0.2, stature: 0.1, kind: "other", staleness: false, israelRelevant: false, publisher: null, categories: [], vendor: null, technology: null },
    ]);
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    const report = update.data.report as {
      staleDropped: number;
      undatedDropped: number;
      dropReasons: Record<string, number>;
      floorDrops: Record<string, number>;
    };
    expect(report.undatedDropped).toBe(1);
    expect(report.staleDropped).toBe(1);
    // The journal names the reason — a bare count is not auditable.
    expect(report.dropReasons.no_extractable_date).toBe(1);
    expect(report.dropReasons.older_than_window).toBe(1);
    // and the same two are saved as evidence under the `freshness` floor
    expect(report.floorDrops.freshness).toBe(2);
    // and the surviving triage input must not contain the dropped URLs
    const seenUrls = (triageAll.mock.calls[0][0] as { url: string }[]).map((i) => i.url);
    expect(seenUrls).toEqual(["https://news.com/fresh"]);
  });

  it("finishes as an explained silence when every item is stale or undated", async () => {
    const staleDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    resolvePacksForOrg.mockResolvedValue({ ...NO_PACKS, packs: [{ industryKey: "k", sources: [], taxonomy: [] }] });
    fetchSourcePack.mockResolvedValue({
      items: [
        packedItem({ title: "undated", url: "https://news.com/undated", publishedAt: null }),
        packedItem({ title: "stale", url: "https://news.com/stale", publishedAt: staleDate }),
      ],
      perSource: [],
    });
    await personScan("org1");
    expect(triageAll).not.toHaveBeenCalled();
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    const report = update.data.report as { staleDropped: number; undatedDropped: number; dropReasons: Record<string, number> };
    expect(report.staleDropped).toBe(1);
    expect(report.undatedDropped).toBe(1);
    expect(report.dropReasons).toEqual({ no_extractable_date: 1, older_than_window: 1 });
    // Freshness rejections are saved even on the commonest early exit — that is why the
    // dropout write lives in finish() rather than at the end of the happy path.
    expect(dropoutCreateMany).toHaveBeenCalledTimes(1);
    expect((dropoutCreateMany.mock.calls[0][0] as { data: unknown[] }).data).toHaveLength(2);
  });

  /**
   * The pool's UNIQUE query count. Phase B narrowed what it counts — the named channel,
   * built in code from competitor and employer names — but not why it is reported: it is
   * the only part of the intake that spends a provider call, and two people watching the
   * same name pay for it once.
   */
  it("reports the named channel's distinct query count, deduped across people", async () => {
    const second = {
      ...subscriber(),
      id: "pp2",
      contact: { ...subscriber().contact, id: "ct2", fullName: "Uri" },
      axes: subscriber().axes.map((a) => ({ ...a, personProfileId: "pp2" })),
    };
    axisFindMany.mockResolvedValue([
      {
        ...subscribedAxis(),
        people: [
          { mutedAt: null, evidence: null, personProfile: { id: "pp1", contactId: "ct1" } },
          { mutedAt: null, evidence: null, personProfile: { id: "pp2", contactId: "ct2" } },
        ],
      },
    ]);
    profileFindMany.mockResolvedValue([subscriber(), second]);
    await personScan("org1");
    // Both work at Delek: one employer name, one query.
    const pool = fetchPoolNews.mock.calls[0][0] as { query: string; companyIds: string[] }[];
    expect(pool).toEqual([{ query: "Delek", companyIds: [] }]);
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect((update.data.report as { uniqueQueries: number }).uniqueQueries).toBe(1);
    expect((update.data.report as { namedQueries: number }).namedQueries).toBe(1);
  });

  /**
   * 2026-08-26 final review, Finding 5. PoolResult.cachedQueries (fetch-pool-news.ts) was
   * computed correctly but never reached PersonScanReport — so a re-fired scan within the
   * query cache's EMPTY_CACHE_TTL_MINUTES window showed `queriesRun: 0` and could not be
   * told apart from a genuinely quiet week. Threaded the same way freshness/uniqueQueries
   * are, via finish().
   */
  it("threads cachedQueries from the pool fetch into the persisted report", async () => {
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 0, cachedQueries: 3, quotaLikely: false, providerStats: [] });
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect((update.data.report as { cachedQueries: number }).cachedQueries).toBe(3);
  });

  it("defaults cachedQueries to 0 on the earliest exit (no subscribed axes)", async () => {
    axisFindMany.mockResolvedValue([]);
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect((update.data.report as { cachedQueries: number }).cachedQueries).toBe(0);
  });

  /**
   * A legacy profile has no `audience`, so `homeMarket()` has no market to check against
   * and the geography gate does not run for that person. A skipped gate that reads as a
   * passed gate is exactly the class of bug this codebase keeps hitting, so the run says
   * whose market was never checked.
   */
  it("names the people whose geography gate was skipped", async () => {
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect((update.data.report as { geoGateSkipped: string[] }).geoGateSkipped).toEqual(["Avigal"]);
  });
});

/**
 * Task 12: a layer-3 axis (built from a dated "what occupies them now" fact) stops
 * contributing PAID queries once that fact's TTL (layers.ts, LAYER3_QUERY_TTL_DAYS) has
 * elapsed. The fact was time-bound; the query should not outlive it. Checked per
 * PersonAxis subscriber, not per axis: one subscriber whose layer-3 fact is still fresh is
 * enough to keep the whole axis's queries in the pool.
 *
 * Phase B: the only paid queries are the named channel's, so the axis under test is the
 * PERSON_ENTITY one that carries a name. The axis's tags are untouched by the TTL — it
 * still classifies items — which is why the assertion is about the QUERY and not about the
 * axis being scanned at all.
 */
describe("personScan layer-3 query TTL", () => {
  const staleDateIso = new Date(Date.now() - 50 * 86_400_000).toISOString();
  const freshDateIso = new Date(Date.now() - 5 * 86_400_000).toISOString();

  function entityAxis(peopleEvidence: unknown[]) {
    return {
      id: "ax-onezero",
      label: "One Zero",
      kind: "PERSON_ENTITY",
      weight: 1,
      people: peopleEvidence.map((evidence, i) => ({
        mutedAt: null,
        evidence,
        personProfile: { id: `pp${i + 1}`, contactId: `ct${i + 1}` },
      })),
    };
  }

  function entitySubscriber(i: number, evidence: unknown) {
    return {
      id: `pp${i}`,
      roleLens: "CEO",
      personalNotes: null,
      audience: null,
      scope: null,
      employerTrackedCompanyId: null,
      contact: {
        id: `ct${i}`, ownerId: "u1", fullName: `P${i}`, hebrewFirstName: null,
        currentTitle: "CEO", currentCompany: null, experience: null,
      },
      axes: [
        {
          axisId: "ax-onezero",
          personProfileId: `pp${i}`,
          source: "PERSON_ENTITY",
          mutedAt: null,
          agenda: false,
          weight: 1,
          rationale: "מתחרה",
          evidence,
          axis: { id: "ax-onezero", label: "One Zero", kind: "PERSON_ENTITY" },
        },
      ],
    };
  }

  it("asks nothing for an axis whose every subscriber's layer-3 fact is expired, and names it in expiredLayer3", async () => {
    const evidence = { layerEvidence: { layer: 3, quote: "q", dateIso: staleDateIso } };
    axisFindMany.mockResolvedValue([entityAxis([evidence])]);
    profileFindMany.mockResolvedValue([entitySubscriber(1, evidence)]);

    await personScan("org1");

    // No name left to ask about, so the paid channel is not even called.
    expect(fetchPoolNews).not.toHaveBeenCalled();
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    const report = update.data.report as { expiredLayer3: string[]; uniqueQueries: number };
    expect(report.expiredLayer3).toEqual(["One Zero"]);
    expect(report.uniqueQueries).toBe(0);
  });

  it("keeps asking when at least one subscriber's layer-3 fact is not expired", async () => {
    const stale = { layerEvidence: { layer: 3, quote: "old", dateIso: staleDateIso } };
    const still = { layerEvidence: { layer: 3, quote: "new", dateIso: freshDateIso } };
    axisFindMany.mockResolvedValue([entityAxis([stale, still])]);
    profileFindMany.mockResolvedValue([entitySubscriber(1, stale), entitySubscriber(2, still)]);

    await personScan("org1");

    const pool = fetchPoolNews.mock.calls[0][0] as { query: string; companyIds: string[] }[];
    expect(pool.map((p) => p.query)).toEqual(["One Zero"]);
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect((update.data.report as { expiredLayer3: string[] }).expiredLayer3).toEqual([]);
  });

  it("keeps an axis whose subscriber has no layer-3 evidence at all (layer 4 / missing)", async () => {
    axisFindMany.mockResolvedValue([entityAxis([null])]);
    profileFindMany.mockResolvedValue([entitySubscriber(1, null)]);

    await personScan("org1");

    const pool = fetchPoolNews.mock.calls[0][0] as { query: string; companyIds: string[] }[];
    expect(pool.map((p) => p.query)).toEqual(["One Zero"]);
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect((update.data.report as { expiredLayer3: string[] }).expiredLayer3).toEqual([]);
  });
});

/**
 * Task 12: `articlesByLayer` (layers.ts) counts, per item, the DEEPEST layer its matched
 * axes reached. Phase B changed what produces a match: floor 1 picks the NARROWEST tier
 * that reached the person (entity, then their own subject, then the shared industry net)
 * and the AxisMatch row is written on that axis — so the layer a match counts at follows
 * the tier, and one (person, item) pair produces exactly one row.
 */
describe("personScan articlesByLayer", () => {
  it("counts a match at the layer of the axis the floors chose, and persists it in the report", async () => {
    const freshDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const industryAxis = { id: "aInd", label: "ענף: Fintech", kind: "INDUSTRY", weight: 1, people: [{ mutedAt: null, evidence: null, personProfile: { id: "pp1", contactId: "ct1" } }] };
    const roleAxis = { id: "aRole", label: "אשראי-צרכני", kind: "ROLE_COMPANY", weight: 1, people: [{ mutedAt: null, evidence: null, personProfile: { id: "pp1", contactId: "ct1" } }] };
    axisFindMany.mockResolvedValue([industryAxis, roleAxis]);
    profileFindMany.mockResolvedValue([
      {
        ...subscriber(),
        axes: [
          { axisId: "aInd", personProfileId: "pp1", source: "INDUSTRY", mutedAt: null, agenda: false, weight: 1, rationale: "ענף", evidence: null, axis: { id: "aInd", label: "ענף: Fintech", kind: "INDUSTRY" } },
          { axisId: "aRole", personProfileId: "pp1", source: "ROLE_COMPANY", mutedAt: null, agenda: false, weight: 1, rationale: "התיק שלו", evidence: null, axis: { id: "aRole", label: "אשראי-צרכני", kind: "ROLE_COMPANY" } },
        ],
      },
    ]);
    // "Fintech" normalises into the banking family, so his INDUSTRY subscription resolves
    // to this pack and its taxonomy becomes his BROAD tier.
    resolvePacksForOrg.mockResolvedValue({
      ...NO_PACKS,
      packs: [{ industryKey: "banking finance", sources: [], taxonomy: [{ tag: "אשראי-צרכני", label: "אשראי צרכני" }, { tag: "תשלומים", label: "תשלומים" }] }],
    });
    fetchSourcePack.mockResolvedValue({ items: [packedItem({ publishedAt: freshDate })], perSource: [] });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.9, stature: 0.9, kind: "research", staleness: false, israelRelevant: false, publisher: null, categories: [], industryTags: ["אשראי-צרכני"], vendor: null, technology: null },
    ]);
    readPage.mockResolvedValue(null);
    synthesizeItem.mockResolvedValue({
      title: "t", summary: "s", technology: null, vendor: null, categories: [],
      sources: [{ url: "https://news.com/1", title: "t", publishedAt: freshDate }],
      publishedAt: freshDate, thin: true, shareworthy: 0.9, stature: 0.9, kind: "research",
    });
    upsertTechItem.mockResolvedValue("item1");
    techItemUpdate.mockResolvedValue({});
    chooseForPerson.mockResolvedValue({ picks: [{ itemId: "item1", why: "בדיוק התיק שלו" }], outcome: "judged" });
    judgeAndDraft.mockResolvedValue({ candidates: 1, ranked: 1, vetoed: 0, vetoFaults: 0, drafted: 1, dropReasons: {}, unknownSourceHosts: [] });

    await personScan("org1");

    // The tag is his OWN subject as well as an industry tag, and the focused tier wins
    // outright — so the row is written on the ROLE_COMPANY axis: layer 4.
    const args = axisMatchUpsert.mock.calls[0][0] as { where: { axisId_itemId: { axisId: string } } };
    expect(args.where.axisId_itemId.axisId).toBe("aRole");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    const report = update.data.report as { articlesByLayer: { layer1: number; layer3: number; layer4: number } };
    expect(report.articlesByLayer).toEqual({ layer1: 0, layer3: 0, layer4: 1 });
  });

  it("defaults articlesByLayer to all-zero on an early exit (no subscribed axes)", async () => {
    axisFindMany.mockResolvedValue([]);
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    const report = update.data.report as { articlesByLayer: { layer1: number; layer3: number; layer4: number } };
    expect(report.articlesByLayer).toEqual({ layer1: 0, layer3: 0, layer4: 0 });
  });
});

/**
 * The rebuild report reads this to say what the NEXT scan will spend. Phase B moved the
 * answer — the pack pull is free, so the only billable queries are the narrow named
 * channel's — and it must build them through the same builder the run itself uses, or the
 * number a human budgets against is not the number that gets billed.
 */
describe("poolQueryCount", () => {
  it("counts the named channel's distinct queries, not axes", async () => {
    axisFindMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
    profileFindMany.mockResolvedValue([subscriber()]);
    expect(await poolQueryCount("org1")).toEqual({ axes: 3, uniqueQueries: 1 });
  });

  it("ignores axes nobody subscribes to — they represent nobody", async () => {
    axisFindMany.mockResolvedValue([]);
    profileFindMany.mockResolvedValue([]);
    await poolQueryCount("org1");
    expect(axisFindMany.mock.calls[0][0].where).toEqual({
      orgId: "org1",
      status: "ACTIVE",
      people: { some: {} },
    });
  });

  /**
   * Fix round 1 (2026-08-27): poolQueryCount originally did not mirror personScan's
   * layer-3 query TTL filter, so it overstated what the run would actually spend —
   * exactly the number a human budgets a nearly-exhausted news quota against.
   *
   * Phase B note: the TTL is applied inside personScan, over the axes it has already
   * loaded, and this function counts the same NAMES through the same builder. The entity
   * whose fact expired is therefore counted here and skipped there — a difference of one
   * query in the conservative direction (over-report, never under-report), and the
   * alternative would be a second copy of the TTL logic to drift.
   */
  it("counts every name, including one whose layer-3 fact has expired — over-reporting, never under", async () => {
    const staleDateIso = new Date(Date.now() - 50 * 86_400_000).toISOString();
    axisFindMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    profileFindMany.mockResolvedValue([
      {
        ...subscriber(),
        axes: [
          ...subscriber().axes,
          {
            axisId: "a2", personProfileId: "pp1", source: "PERSON_ENTITY", mutedAt: null,
            agenda: false, weight: 1, rationale: "מתחרה",
            evidence: { layerEvidence: { layer: 3, quote: "q", dateIso: staleDateIso } },
            axis: { id: "a2", label: "One Zero", kind: "PERSON_ENTITY" },
          },
        ],
      },
    ]);
    expect(await poolQueryCount("org1")).toEqual({ axes: 2, uniqueQueries: 2 });
  });
});
