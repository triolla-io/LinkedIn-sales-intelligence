import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCompanyFindUniqueOrThrow = vi.fn();
const mockCompanyUpdate = vi.fn();
const mockSignalFindUnique = vi.fn();
const mockSignalCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findUniqueOrThrow: (...a: unknown[]) => mockCompanyFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockCompanyUpdate(...a),
    },
    companySignal: {
      findUnique: (...a: unknown[]) => mockSignalFindUnique(...a),
      create: (...a: unknown[]) => mockSignalCreate(...a),
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
});

describe("detectAndRecordSignals", () => {
  it("creates a verified signal and returns its id", async () => {
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: null,
      sources: [{ name: "TC", url: "https://techcrunch.com/a", publishedAt: null }, { name: "CC", url: "https://calcalist.co.il/b", publishedAt: null }],
    }]);
    const res = await detectAndRecordSignals("co1");
    expect(res.detected).toBe(1);
    expect(res.verifiedNewIds).toEqual(["sig1"]);
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
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).toHaveBeenCalledOnce();
    expect(res.verifiedNewIds).toEqual(["sig1"]);
  });

  it("exits quietly (still bumps lastSignalCheckAt) when no news", async () => {
    mockNews.mockResolvedValue([]);
    mockExtract.mockResolvedValue([]);
    const res = await detectAndRecordSignals("co1");
    expect(res).toEqual({ detected: 0, verifiedNewIds: [] });
    expect(mockCompanyUpdate).toHaveBeenCalledOnce();
  });
});
