import { describe, it, expect, vi, beforeEach } from "vitest";

const companyFindUniqueOrThrow = vi.fn();
const companyUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    trackedCompany: {
      findUniqueOrThrow: (...a: unknown[]) => companyFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => companyUpdate(...a),
    },
  },
}));

const readPage = vi.fn();
const readPages = vi.fn();
vi.mock("@/lib/research/read-page", () => ({
  readPage: (...a: unknown[]) => readPage(...a),
  readPages: (...a: unknown[]) => readPages(...a),
  MAX_PAGE_CHARS: 8000,
}));

const fetchCompanyNews = vi.fn();
vi.mock("@/lib/news/fetch-company-news", () => ({
  fetchCompanyNews: (...a: unknown[]) => fetchCompanyNews(...a),
}));

const researchProfile = vi.fn();
vi.mock("@/lib/tech-radar/profile", async () => {
  const actual = await import("@/lib/tech-radar/profile");
  return { ...actual, researchProfile: (...a: unknown[]) => researchProfile(...a) };
});

const { researchTrackedCompany } = await import("@/lib/tech-radar/research-company");

const HOMEPAGE_HTML = `
  <html><body>
    <a href="/products">מוצרים</a>
    <a href="/solutions">Business solutions</a>
    <a href="/careers">Careers</a>
  </body></html>
`;

const profile = {
  businessLines: [{ name: "Retail", description: "d" }],
  products: [], customerSegments: [], techStack: [], digitalInitiatives: [],
  focusAreas: [{ area: "fraud", why: "w" }],
  searchQueries: ["fraud detection launch"],
  sources: [],
};

const fetchMock = vi.fn();

beforeEach(() => {
  for (const m of [companyFindUniqueOrThrow, companyUpdate, readPage, readPages, fetchCompanyNews, researchProfile, fetchMock]) {
    m.mockReset();
  }
  vi.stubGlobal("fetch", fetchMock);
  companyFindUniqueOrThrow.mockResolvedValue({
    id: "c1", name: "בנק הפועלים", website: "https://bank.co.il",
  });
  // readPage returns EXTRACTED TEXT — never markup. That is the whole point below.
  readPage.mockResolvedValue({ url: "https://bank.co.il", title: "Home", text: "דלג לתוכן מוצרים פתרונות" });
  readPages.mockResolvedValue([
    { url: "https://bank.co.il/products", title: "Products", text: "products page" },
  ]);
  fetchCompanyNews.mockResolvedValue([]);
  researchProfile.mockResolvedValue(profile);
  fetchMock.mockResolvedValue({
    ok: true, status: 200,
    headers: { get: () => "text/html" },
    text: async () => HOMEPAGE_HTML,
  });
});

describe("researchTrackedCompany", () => {
  /**
   * readPage returns clean extracted TEXT with no anchors, so choosing inner pages from
   * it can never find a link — the live bring-up run read exactly 1 source for Bank
   * Hapoalim. Inner-link selection must run against the raw homepage HTML.
   */
  it("selects inner pages from the raw homepage HTML, not the extracted text", async () => {
    await researchTrackedCompany("c1");
    expect(fetchMock).toHaveBeenCalled();
    const urls = readPages.mock.calls[0][0] as string[];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls).toContain("https://bank.co.il/products");
    expect(urls).not.toContain("https://bank.co.il/careers");
  });

  it("passes the homepage plus the inner pages to the profiler", async () => {
    await researchTrackedCompany("c1");
    const input = researchProfile.mock.calls[0][0] as { pages: { url: string }[] };
    expect(input.pages.map((p) => p.url)).toEqual([
      "https://bank.co.il",
      "https://bank.co.il/products",
    ]);
  });

  it("still succeeds when the raw HTML fetch fails — inner pages are a bonus", async () => {
    fetchMock.mockRejectedValue(new Error("blocked"));
    const out = await researchTrackedCompany("c1");
    expect(out.status).toBe("ACTIVE");
    const input = researchProfile.mock.calls[0][0] as { pages: { url: string }[] };
    expect(input.pages.map((p) => p.url)).toEqual(["https://bank.co.il"]);
  });

  it("normalizes a bare domain to https before fetching", async () => {
    companyFindUniqueOrThrow.mockResolvedValue({ id: "c1", name: "x", website: "bank.co.il" });
    await researchTrackedCompany("c1");
    expect(readPage.mock.calls[0][0]).toBe("https://bank.co.il");
  });

  it("records RESEARCH_FAILED with the reason when profiling throws", async () => {
    researchProfile.mockRejectedValue(new Error("no focus areas"));
    const out = await researchTrackedCompany("c1");
    expect(out).toEqual({ status: "RESEARCH_FAILED", error: "no focus areas" });
    expect(companyUpdate.mock.calls[0][0].data).toMatchObject({
      status: "RESEARCH_FAILED", profileError: "no focus areas",
    });
  });

  it("activates the company and stores the profile on success", async () => {
    const out = await researchTrackedCompany("c1");
    expect(out.status).toBe("ACTIVE");
    expect(companyUpdate.mock.calls[0][0].data).toMatchObject({ status: "ACTIVE", profileError: null });
  });
});
