import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCompanyFindUniqueOrThrow = vi.fn();
const mockCompanyUpdate = vi.fn();
const mockSignalFindUnique = vi.fn();
const mockSignalCreate = vi.fn();
const mockSignalFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findUniqueOrThrow: (...a: unknown[]) => mockCompanyFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockCompanyUpdate(...a),
    },
    companySignal: {
      findUnique: (...a: unknown[]) => mockSignalFindUnique(...a),
      create: (...a: unknown[]) => mockSignalCreate(...a),
      findMany: (...a: unknown[]) => mockSignalFindMany(...a),
    },
  },
}));

vi.mock("@/lib/news/fetch-company-news", () => ({ fetchCompanyNews: vi.fn() }));
vi.mock("@/lib/company-signals/extract", async (orig) => {
  const actual = await orig<typeof import("@/lib/company-signals/extract")>();
  return { ...actual, extractCompanySignals: vi.fn() };
});

import { detectAndRecordSignals } from "@/lib/company-signals/detect";
import { fetchCompanyNews } from "@/lib/news/fetch-company-news";
import { extractCompanySignals } from "@/lib/company-signals/extract";

const mockNews = vi.mocked(fetchCompanyNews);
const mockExtract = vi.mocked(extractCompanySignals);

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanyFindUniqueOrThrow.mockResolvedValue({ id: "co1", name: "Acme", website: "https://acme.com" });
  mockCompanyUpdate.mockResolvedValue({});
  mockSignalFindUnique.mockResolvedValue(null);
  mockSignalCreate.mockImplementation(async (args: { data: { verified: boolean } }) => ({
    id: "sig1", verified: args.data.verified,
  }));
  // Fan-out is derived from durable state (verified-but-not-DRAFTED). Default: nothing to draft;
  // tests that expect a draft set this to the appropriate VERIFIED rows.
  mockSignalFindMany.mockResolvedValue([]);
});

describe("detectAndRecordSignals", () => {
  it("creates a verified signal and returns its id", async () => {
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: null,
      sources: [{ name: "TC", url: "https://techcrunch.com/a", publishedAt: null }, { name: "CC", url: "https://calcalist.co.il/b", publishedAt: null }],
    }]);
    mockSignalFindMany.mockResolvedValue([{ id: "sig1" }]);
    const res = await detectAndRecordSignals("co1");
    expect(res.detected).toBe(1);
    expect(res.verifiedNewIds).toEqual(["sig1"]);
    expect(mockSignalFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: "co1", verified: true, status: "VERIFIED" }),
    }));
    expect(mockCompanyUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastSignalCheckAt: expect.any(Date) }) }));
  });

  it("skips an event whose dedupeKey already exists", async () => {
    mockSignalFindUnique.mockResolvedValue({ id: "existing" });
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: null,
      sources: [{ name: "TC", url: "https://techcrunch.com/a", publishedAt: null }, { name: "CC", url: "https://calcalist.co.il/b", publishedAt: null }],
    }]);
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).not.toHaveBeenCalled();
    expect(res.verifiedNewIds).toEqual([]);
  });

  it("records an unverified single-domain event but does NOT return it", async () => {
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "AWARD", title: "Won X", summary: "s", eventDate: null,
      sources: [{ name: "Blog", url: "https://blog.example.com/a", publishedAt: null }],
    }]);
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).toHaveBeenCalledOnce();
    expect(res.verifiedNewIds).toEqual([]);
  });

  it("coerces an unparseable LLM eventDate to null and still advances lastSignalCheckAt", async () => {
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: "Q1 2025",
      sources: [{ name: "TC", url: "https://techcrunch.com/a", publishedAt: null }, { name: "CC", url: "https://calcalist.co.il/b", publishedAt: null }],
    }]);
    mockSignalFindMany.mockResolvedValue([{ id: "sig1" }]);
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).toHaveBeenCalledOnce();
    expect(mockSignalCreate.mock.calls[0][0].data.eventDate).toBeNull();
    expect(res.verifiedNewIds).toEqual(["sig1"]);
    expect(mockCompanyUpdate).toHaveBeenCalledOnce();
  });

  it("verifies a single source on the official bare-domain website", async () => {
    mockCompanyFindUniqueOrThrow.mockResolvedValue({ id: "co1", name: "Acme", website: "acme.com" });
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "PRODUCT_LAUNCH", title: "Launched Y", summary: "s", eventDate: null,
      sources: [{ name: "Acme", url: "https://acme.com/blog/launch", publishedAt: null }],
    }]);
    mockSignalFindMany.mockResolvedValue([{ id: "sig1" }]);
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).toHaveBeenCalledOnce();
    expect(res.verifiedNewIds).toEqual(["sig1"]);
  });

  it("returns a VERIFIED signal that already exists (dedup skips create) so Inngest retries don't drop its draft", async () => {
    // Retry scenario: on a re-run of the enclosing step, the signal was created VERIFIED on a
    // prior attempt, so findUnique returns it and the dedup `continue` skips create — yet it still
    // needs a draft. The fan-out must come from durable state (findMany), not this run's creates.
    mockSignalFindUnique.mockResolvedValue({ id: "existing" });
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: null,
      sources: [{ name: "TC", url: "https://techcrunch.com/a", publishedAt: null }, { name: "CC", url: "https://calcalist.co.il/b", publishedAt: null }],
    }]);
    mockSignalFindMany.mockResolvedValue([{ id: "existing" }]);
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).not.toHaveBeenCalled();
    expect(res.detected).toBe(0);
    expect(res.verifiedNewIds).toEqual(["existing"]);
    expect(mockCompanyUpdate).toHaveBeenCalledOnce();
  });

  it("exits quietly (still bumps lastSignalCheckAt) when no news", async () => {
    mockNews.mockResolvedValue([]);
    mockExtract.mockResolvedValue([]);
    const res = await detectAndRecordSignals("co1");
    expect(res).toEqual({ detected: 0, verifiedNewIds: [] });
    expect(mockCompanyUpdate).toHaveBeenCalledOnce();
  });
});
