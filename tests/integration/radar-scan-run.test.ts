import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Every personScan run must open a RadarScanRun row before any work and close it with
 * the funnel counters on EVERY exit path — the decisions tab renders this row, and the
 * approvals subline reads it. A path that returns without closing the run shows up in
 * the UI as a scan that never happened.
 */

const axisFindMany = vi.fn();
const scanRunCreate = vi.fn();
const scanRunUpdate = vi.fn();
const scanRunFindUnique = vi.fn();
const axisMatchFindUnique = vi.fn();
const axisMatchCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: { findMany: (...a: unknown[]) => axisFindMany(...a) },
    radarScanRun: {
      create: (...a: unknown[]) => scanRunCreate(...a),
      update: (...a: unknown[]) => scanRunUpdate(...a),
      findUnique: (...a: unknown[]) => scanRunFindUnique(...a),
    },
    axisMatch: {
      findUnique: (...a: unknown[]) => axisMatchFindUnique(...a),
      create: (...a: unknown[]) => axisMatchCreate(...a),
    },
  },
}));

const fetchPoolNews = vi.fn();

vi.mock("@/lib/tech-radar/fetch-pool-news", () => ({
  fetchPoolNews: (...a: unknown[]) => fetchPoolNews(...a),
  SCAN_WINDOW_DAYS: 30,
}));
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
const judgeAxisFit = vi.fn();
vi.mock("@/lib/tech-radar/axis-fit", async () => {
  const actual = await import("@/lib/tech-radar/axis-fit");
  return { ...actual, judgeAxisFit: (...a: unknown[]) => judgeAxisFit(...a) };
});
const judgeAndDraft = vi.fn();
vi.mock("@/lib/tech-radar/judge-and-draft", () => ({ judgeAndDraft: (...a: unknown[]) => judgeAndDraft(...a) }));
const upsertTechItem = vi.fn();
vi.mock("@/lib/tech-radar/persist", () => ({ upsertTechItem: (...a: unknown[]) => upsertTechItem(...a) }));

const { personScan, poolQueryCount, openScanRun } = await import("@/lib/tech-radar/person-scan");

function subscribedAxis() {
  return {
    id: "a1",
    label: "חבות RIN",
    searchQueries: ["RIN obligations refiners"],
    weight: 1,
    people: [
      {
        weight: 1,
        rationale: "הוא מחזיק בהחלטת התפוקה",
        personProfile: {
          contactId: "ct1",
          roleLens: "CEO",
          personalNotes: null,
          employerTrackedCompanyId: null,
          contact: { id: "ct1", ownerId: "u1", fullName: "Avigal", hebrewFirstName: null, currentTitle: "CEO", currentCompany: "Delek" },
        },
      },
    ],
  };
}

beforeEach(() => {
  for (const m of [
    axisFindMany, scanRunCreate, scanRunUpdate, scanRunFindUnique, axisMatchFindUnique, axisMatchCreate,
    fetchPoolNews, triageAll, synthesizeItem, readPage, judgeAxisFit, judgeAndDraft, upsertTechItem,
  ]) m.mockReset();
  scanRunCreate.mockResolvedValue({ id: "run1" });
  scanRunUpdate.mockResolvedValue({});
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
    fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 4, quotaLikely: true });
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ scanned: 0, drafts: 0 });
    expect((update.data.report as { quotaExhausted: boolean }).quotaExhausted).toBe(true);
  });

  it("records the funnel: seen items that triage rejected count as scanned, not topical", async () => {
    const freshDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    fetchPoolNews.mockResolvedValue({
      items: [{ title: "t", url: "https://news.com/1", snippet: "s", source: "tavily", publishedAt: freshDate, companyIds: ["a1"] }],
      queriesRun: 1,
      quotaLikely: false,
    });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.2, stature: 0.1, kind: "other", staleness: false, categories: [], vendor: null, technology: null },
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
    fetchPoolNews.mockResolvedValue({
      items: [
        { title: "fresh", url: "https://news.com/fresh", snippet: "s", source: "tavily", publishedAt: freshDate, companyIds: ["a1"] },
        { title: "undated", url: "https://news.com/undated", snippet: "s", source: "tavily", publishedAt: null, companyIds: ["a1"] },
        { title: "stale", url: "https://news.com/stale", snippet: "s", source: "tavily", publishedAt: staleDate, companyIds: ["a1"] },
      ],
      queriesRun: 1,
      quotaLikely: false,
    });
    triageAll.mockResolvedValue([
      { url: "https://news.com/fresh", shareworthy: 0.2, stature: 0.1, kind: "other", staleness: false, categories: [], vendor: null, technology: null },
    ]);
    await personScan("org1");
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    const report = update.data.report as {
      staleDropped: number;
      undatedDropped: number;
      dropReasons: Record<string, number>;
    };
    expect(report.undatedDropped).toBe(1);
    expect(report.staleDropped).toBe(1);
    // The journal names the reason — a bare count is not auditable.
    expect(report.dropReasons.no_extractable_date).toBe(1);
    expect(report.dropReasons.older_than_window).toBe(1);
    // and the surviving triage input must not contain the dropped URLs
    const seenUrls = (triageAll.mock.calls[0][0] as { url: string }[]).map((i) => i.url);
    expect(seenUrls).toEqual(["https://news.com/fresh"]);
  });

  it("finishes as an explained silence when every item is stale or undated", async () => {
    const staleDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
    axisFindMany.mockResolvedValue([subscribedAxis()]);
    fetchPoolNews.mockResolvedValue({
      items: [
        { title: "undated", url: "https://news.com/undated", snippet: "s", source: "tavily", publishedAt: null, companyIds: ["a1"] },
        { title: "stale", url: "https://news.com/stale", snippet: "s", source: "tavily", publishedAt: staleDate, companyIds: ["a1"] },
      ],
      queriesRun: 2,
      quotaLikely: false,
    });
    await personScan("org1");
    expect(triageAll).not.toHaveBeenCalled();
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    const report = update.data.report as { staleDropped: number; undatedDropped: number; dropReasons: Record<string, number> };
    expect(report.staleDropped).toBe(1);
    expect(report.undatedDropped).toBe(1);
    expect(report.dropReasons).toEqual({ no_extractable_date: 1, older_than_window: 1 });
  });

  /**
   * The pool's UNIQUE query count, which is the number the axis-merge decision has to be
   * judged on. Two axes asking the same string are one fetched query — that dedup is what
   * makes refusing a cross-sector merge affordable, so the report has to show it rather
   * than leave it to be assumed.
   */
  it("reports the pool's distinct query count, not the number of axes that asked", async () => {
    const shared = subscribedAxis();
    axisFindMany.mockResolvedValue([shared, { ...shared, id: "a2", label: "מרווחי זיקוק" }]);
    fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 1, quotaLikely: false });
    await personScan("org1");
    // One pooled query, both axes subscribed to it.
    const pool = fetchPoolNews.mock.calls[0][0] as { query: string; companyIds: string[] }[];
    expect(pool).toHaveLength(1);
    expect(pool[0].companyIds).toEqual(["a1", "a2"]);
    const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect((update.data.report as { uniqueQueries: number }).uniqueQueries).toBe(1);
  });
});

/**
 * The rebuild report reads this to say what the competitive-set gate cost. It must build
 * the pool exactly as the run does — same normalizer, same 3-per-axis cap — or the number
 * a human budgets against is not the number that gets billed.
 */
describe("poolQueryCount", () => {
  it("counts distinct query strings, not axes", async () => {
    const shared = subscribedAxis();
    axisFindMany.mockResolvedValue([
      { id: "a1", searchQueries: shared.searchQueries },
      { id: "a2", searchQueries: shared.searchQueries },
      { id: "a3", searchQueries: ["בנקאות פתוחה ישראל", "open banking Israel"] },
    ]);
    expect(await poolQueryCount("org1")).toEqual({ axes: 3, uniqueQueries: 3 });
  });

  it("ignores axes nobody subscribes to — they send no query", async () => {
    axisFindMany.mockResolvedValue([]);
    await poolQueryCount("org1");
    expect(axisFindMany.mock.calls[0][0].where).toEqual({
      orgId: "org1",
      status: "ACTIVE",
      people: { some: {} },
    });
  });
});
