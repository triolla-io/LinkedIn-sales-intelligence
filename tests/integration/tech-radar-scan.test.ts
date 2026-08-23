import { describe, it, expect, vi, beforeEach } from "vitest";

const companyFindMany = vi.fn();
const companyUpdateMany = vi.fn();
const opportunityFindMany = vi.fn();
const opportunityFindUnique = vi.fn();
const opportunityCreate = vi.fn();
const itemFindUnique = vi.fn();
const itemFindMany = vi.fn();
const itemCreate = vi.fn();
const itemUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    trackedCompany: {
      findMany: (...a: unknown[]) => companyFindMany(...a),
      updateMany: (...a: unknown[]) => companyUpdateMany(...a),
    },
    techOpportunity: {
      findMany: (...a: unknown[]) => opportunityFindMany(...a),
      findUnique: (...a: unknown[]) => opportunityFindUnique(...a),
      create: (...a: unknown[]) => opportunityCreate(...a),
    },
    techItem: {
      findUnique: (...a: unknown[]) => itemFindUnique(...a),
      findMany: (...a: unknown[]) => itemFindMany(...a),
      create: (...a: unknown[]) => itemCreate(...a),
      update: (...a: unknown[]) => itemUpdate(...a),
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
const judgeFit = vi.fn();
vi.mock("@/lib/tech-radar/fit", async () => {
  const actual = await import("@/lib/tech-radar/fit");
  return { ...actual, judgeFit: (...a: unknown[]) => judgeFit(...a) };
});
const readPage = vi.fn();
vi.mock("@/lib/research/read-page", () => ({
  readPage: (...a: unknown[]) => readPage(...a),
  readPages: async () => [],
  MAX_PAGE_CHARS: 8000,
}));

const { scanOrg, loadScannableCompanies } = await import("@/lib/tech-radar/scan");

const profile = {
  businessLines: [{ name: "Retail payments", description: "cards" }],
  products: ["Bit"],
  customerSegments: [],
  techStack: [],
  digitalInitiatives: [],
  focusAreas: [{ area: "fraud detection", why: "card volume" }],
  searchQueries: ["fraud detection launch"],
  sources: [{ url: "https://bank.co.il", title: "home" }],
};

function poolItem(url: string) {
  return { title: `Launch at ${url}`, url, snippet: "s", source: "tavily", publishedAt: null, companyIds: ["c1"] };
}

beforeEach(() => {
  for (const m of [
    companyFindMany, companyUpdateMany, opportunityFindMany, opportunityFindUnique,
    opportunityCreate, itemFindUnique, itemFindMany, itemCreate, itemUpdate,
    fetchPoolNews, triageAll, synthesizeItem, judgeFit, readPage,
  ]) m.mockReset();
  opportunityFindMany.mockResolvedValue([]);
  opportunityFindUnique.mockResolvedValue(null);
  opportunityCreate.mockResolvedValue({ id: "o1" });
  itemFindUnique.mockResolvedValue(null);
  // No sibling items, so every synthesised draft creates a fresh row.
  itemFindMany.mockResolvedValue([]);
  itemCreate.mockResolvedValue({ id: "i1" });
  readPage.mockResolvedValue({ url: "https://news.com/1", title: "t", text: "body" });
});

describe("loadScannableCompanies", () => {
  const now = new Date("2026-08-18T00:00:00Z");

  it("includes a company never scanned", async () => {
    companyFindMany.mockResolvedValue([
      { id: "c1", name: "A", profile, lastScanAt: null, scanIntervalDays: 7 },
    ]);
    expect(await loadScannableCompanies("org1", now)).toHaveLength(1);
  });

  // The tiered-cadence lever: a PROSPECT on a 14-day interval must not be scanned weekly.
  it("respects each company's own interval", async () => {
    companyFindMany.mockResolvedValue([
      { id: "due", name: "Due", profile, lastScanAt: new Date("2026-08-10T00:00:00Z"), scanIntervalDays: 7 },
      { id: "notdue", name: "NotDue", profile, lastScanAt: new Date("2026-08-10T00:00:00Z"), scanIntervalDays: 14 },
    ]);
    const out = await loadScannableCompanies("org1", now);
    expect(out.map((c) => c.id)).toEqual(["due"]);
  });

  // The gate that stops a failed profile emitting random opportunities.
  it("excludes companies whose profile has no focus areas or queries", async () => {
    companyFindMany.mockResolvedValue([
      { id: "c1", name: "A", profile: { ...profile, focusAreas: [] }, lastScanAt: null, scanIntervalDays: 7 },
      { id: "c2", name: "B", profile: { ...profile, searchQueries: [] }, lastScanAt: null, scanIntervalDays: 7 },
      { id: "c3", name: "C", profile: null, lastScanAt: null, scanIntervalDays: 7 },
    ]);
    expect(await loadScannableCompanies("org1", now)).toEqual([]);
  });

  it("only asks for ACTIVE companies in this org", async () => {
    companyFindMany.mockResolvedValue([]);
    await loadScannableCompanies("org1", now);
    expect(companyFindMany.mock.calls[0][0].where).toEqual({ orgId: "org1", status: "ACTIVE" });
  });
});

describe("scanOrg", () => {
  function oneCompany() {
    companyFindMany.mockResolvedValue([
      { id: "c1", name: "בנק הפועלים", profile, lastScanAt: null, scanIntervalDays: 7 },
    ]);
  }

  it("returns an empty report and spends nothing when no company is due", async () => {
    companyFindMany.mockResolvedValue([]);
    const report = await scanOrg("org1");
    expect(report.opportunitiesCreated).toBe(0);
    expect(fetchPoolNews).not.toHaveBeenCalled();
  });

  // An exhausted quota must be distinguishable from a genuinely empty week.
  it("propagates quotaExhausted instead of looking like an empty week", async () => {
    oneCompany();
    fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 4, quotaLikely: true });
    const report = await scanOrg("org1");
    expect(report.quotaExhausted).toBe(true);
    expect(report.queriesRun).toBe(4);
    expect(triageAll).not.toHaveBeenCalled();
  });

  it("stops before any write-up when triage finds no launches", async () => {
    oneCompany();
    fetchPoolNews.mockResolvedValue({ items: [poolItem("https://news.com/1")], queriesRun: 1, quotaLikely: false });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.2, kind: "vendor_launch", publisher: null, staleness: false, categories: [], vendor: null, technology: null },
    ]);
    const report = await scanOrg("org1");
    expect(report.worthSharing).toBe(0);
    expect(synthesizeItem).not.toHaveBeenCalled();
  });

  it("writes items up, judges fit and creates opportunities", async () => {
    oneCompany();
    fetchPoolNews.mockResolvedValue({ items: [poolItem("https://news.com/1")], queriesRun: 1, quotaLikely: false });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.8, kind: "research", publisher: null, staleness: false, categories: ["fraud detection"], vendor: "Acme", technology: "Shield" },
    ]);
    synthesizeItem.mockResolvedValue({
      vendor: "Acme", technology: "Shield", title: "t", summary: "s",
      categories: ["fraud detection"], sources: [], publishedAt: null, thin: false,
    });
    judgeFit.mockResolvedValue({ fits: true, fitRationale: "מתחבר לביט", score: 0.8 });

    const report = await scanOrg("org1");
    expect(report.itemsWritten).toBe(1);
    expect(report.opportunitiesCreated).toBe(1);
    expect(opportunityCreate.mock.calls[0][0].data).toMatchObject({
      trackedCompanyId: "c1", fitRationale: "מתחבר לביט", status: "DISCOVERED",
    });
    expect(companyUpdateMany).toHaveBeenCalled();
  });

  it("creates nothing when fit is rejected", async () => {
    oneCompany();
    fetchPoolNews.mockResolvedValue({ items: [poolItem("https://news.com/1")], queriesRun: 1, quotaLikely: false });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.8, kind: "research", publisher: null, staleness: false, categories: ["fraud detection"], vendor: "Acme", technology: "Shield" },
    ]);
    synthesizeItem.mockResolvedValue({
      vendor: "Acme", technology: "Shield", title: "t", summary: "s",
      categories: ["fraud detection"], sources: [], publishedAt: null, thin: false,
    });
    judgeFit.mockResolvedValue({ fits: false, fitRationale: "", score: 0.1 });
    const report = await scanOrg("org1");
    expect(report.opportunitiesCreated).toBe(0);
    expect(opportunityCreate).not.toHaveBeenCalled();
  });

  // One bad item must not lose the whole run.
  it("survives a synthesis failure on one item", async () => {
    oneCompany();
    fetchPoolNews.mockResolvedValue({
      items: [poolItem("https://news.com/1"), poolItem("https://news.com/2")],
      queriesRun: 1, quotaLikely: false,
    });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.8, kind: "research", publisher: null, staleness: false, categories: ["fraud detection"], vendor: "A", technology: "One" },
      { url: "https://news.com/2", shareworthy: 0.8, kind: "research", publisher: null, staleness: false, categories: ["fraud detection"], vendor: "B", technology: "Two" },
    ]);
    synthesizeItem
      .mockRejectedValueOnce(new Error("llm blew up"))
      .mockResolvedValueOnce({
        vendor: "B", technology: "Two", title: "t", summary: "s",
        categories: ["fraud detection"], sources: [], publishedAt: null, thin: false,
      });
    judgeFit.mockResolvedValue({ fits: true, fitRationale: "r", score: 0.5 });
    const report = await scanOrg("org1");
    expect(report.itemsWritten).toBe(1);
    expect(report.opportunitiesCreated).toBe(1);
  });

  it("survives a fit-judgement failure", async () => {
    oneCompany();
    fetchPoolNews.mockResolvedValue({ items: [poolItem("https://news.com/1")], queriesRun: 1, quotaLikely: false });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.8, kind: "research", publisher: null, staleness: false, categories: ["fraud detection"], vendor: "A", technology: "One" },
    ]);
    synthesizeItem.mockResolvedValue({
      vendor: "A", technology: "One", title: "t", summary: "s",
      categories: ["fraud detection"], sources: [], publishedAt: null, thin: false,
    });
    judgeFit.mockRejectedValue(new Error("fit blew up"));
    const report = await scanOrg("org1");
    expect(report.opportunitiesCreated).toBe(0);
    expect(report.itemsWritten).toBe(1);
  });

  // Reusing an item another company already paid to write up is the point of the split.
  /**
   * The final Delek run found 19 launches and the per-run synthesis budget covers 8, so
   * 11 were dropped — in iteration order, which meant the budget was spent on whatever
   * happened to come back first rather than on what the company actually cares about.
   */
  it("spends the synthesis budget on the launches closest to the company profile", async () => {
    oneCompany();
    const urls = Array.from({ length: 12 }, (_, i) => `https://news.com/${i}`);
    fetchPoolNews.mockResolvedValue({
      items: urls.map((u) => poolItem(u)),
      queriesRun: 1,
      quotaLikely: false,
    });
    // Only the LAST item matches the profile's "fraud detection" focus area.
    triageAll.mockResolvedValue(
      urls.map((u, i) => ({
        url: u,
        shareworthy: 0.8, kind: "research", publisher: null, staleness: false,
        categories: i === urls.length - 1 ? ["fraud detection"] : ["unrelated widgets"],
        vendor: "V",
        technology: `Tech${i}`,
      }))
    );
    synthesizeItem.mockImplementation(async () => ({
      vendor: "V", technology: "T", title: "t", summary: "s",
      categories: ["fraud detection"], sources: [], publishedAt: null, thin: false,
    }));
    judgeFit.mockResolvedValue({ fits: false, fitRationale: "", score: 0, businessLine: null });

    await scanOrg("org1");

    // The relevant one must be synthesised despite arriving last.
    const synthesised = synthesizeItem.mock.calls.map((c) => (c[0] as { triage: { url: string } }).triage.url);
    expect(synthesised).toContain(urls[urls.length - 1]);
  });

  it("does not re-judge an item the company already has", async () => {
    oneCompany();
    fetchPoolNews.mockResolvedValue({ items: [poolItem("https://news.com/1")], queriesRun: 1, quotaLikely: false });
    triageAll.mockResolvedValue([
      { url: "https://news.com/1", shareworthy: 0.8, kind: "research", publisher: null, staleness: false, categories: ["fraud detection"], vendor: "A", technology: "One" },
    ]);
    synthesizeItem.mockResolvedValue({
      vendor: "A", technology: "One", title: "t", summary: "s",
      categories: ["fraud detection"], sources: [], publishedAt: null, thin: false,
    });
    opportunityFindMany.mockResolvedValue([{ itemId: "i1" }]);
    const report = await scanOrg("org1");
    expect(judgeFit).not.toHaveBeenCalled();
    expect(report.opportunitiesCreated).toBe(0);
  });
});
