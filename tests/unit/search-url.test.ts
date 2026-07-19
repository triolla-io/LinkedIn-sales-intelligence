import { describe, it, expect } from "vitest";
import { buildSearchUrl, parseSearchTitles, GEO_URNS } from "@/lib/prospecting/search-url";

describe("buildSearchUrl", () => {
  it("restricts network to 2nd-degree only", () => {
    const url = new URL(buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn }, 1));
    expect(url.searchParams.get("network")).toBe('["S"]');
  });

  it("always includes the geoUrn facet", () => {
    const url = new URL(buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.US.urn }, 1));
    expect(url.searchParams.get("geoUrn")).toBe('["103644278"]');
  });

  it("omits the industry param when no industries are selected", () => {
    const noIds = new URL(buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn }, 1));
    const empty = new URL(buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn, industryIds: [] }, 1));
    expect(noIds.searchParams.get("industry")).toBeNull();
    expect(empty.searchParams.get("industry")).toBeNull();
  });

  it("adds industry=[...] for selected industries (multi-select)", () => {
    const url = new URL(
      buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn, industryIds: ["1594", "6"] }, 1)
    );
    expect(url.searchParams.get("industry")).toBe('["1594","6"]');
  });

  it("sets page only from page 2 onward", () => {
    const p1 = new URL(buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn }, 1));
    const p3 = new URL(buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn }, 3));
    expect(p1.searchParams.get("page")).toBeNull();
    expect(p3.searchParams.get("page")).toBe("3");
  });

  it("adds currentCompany=[...] when companyIds are provided", () => {
    const url = new URL(
      buildSearchUrl(
        { keywords: "CEO, CTO", geoUrn: "", companyIds: ["1441"] },
        1,
      ),
    );
    expect(url.searchParams.get("currentCompany")).toBe('["1441"]');
  });

  it("omits currentCompany when companyIds are absent or empty", () => {
    const none = new URL(
      buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn }, 1),
    );
    const empty = new URL(
      buildSearchUrl(
        { keywords: "ceo", geoUrn: GEO_URNS.IL.urn, companyIds: [] },
        1,
      ),
    );
    expect(none.searchParams.get("currentCompany")).toBeNull();
    expect(empty.searchParams.get("currentCompany")).toBeNull();
  });

  it("overrides network when provided (company runs use S+O)", () => {
    const url = new URL(
      buildSearchUrl({ keywords: "ceo", geoUrn: "", network: ["S", "O"] }, 1),
    );
    expect(url.searchParams.get("network")).toBe('["S","O"]');
  });

  it("keeps 2nd-degree-only network by default", () => {
    const url = new URL(
      buildSearchUrl({ keywords: "ceo", geoUrn: GEO_URNS.IL.urn }, 1),
    );
    expect(url.searchParams.get("network")).toBe('["S"]');
  });

  it("omits geoUrn entirely for empty-string geo (worldwide)", () => {
    const url = new URL(buildSearchUrl({ keywords: "ceo", geoUrn: "" }, 1));
    expect(url.searchParams.get("geoUrn")).toBeNull();
  });

  it("still defaults geoUrn to IL when undefined", () => {
    const url = new URL(buildSearchUrl({ keywords: "ceo" }, 1));
    expect(url.searchParams.get("geoUrn")).toBe(`["${GEO_URNS.IL.urn}"]`);
  });
});

describe("parseSearchTitles", () => {
  it("splits the C-level list into individual Latin titles, dropping the non-ASCII Hebrew ones", () => {
    expect(
      parseSearchTitles('CEO, CTO, CFO, COO, CMO, Founder, Owner, מנכ"ל, סמנכ"ל'),
    ).toEqual(["CEO", "CTO", "CFO", "COO", "CMO", "Founder", "Owner"]);
  });

  it("returns a single bare title", () => {
    expect(parseSearchTitles("CEO")).toEqual(["CEO"]);
  });

  it("phrase-wraps multi-word titles so they match as a phrase", () => {
    expect(parseSearchTitles("VP R&D, CTO")).toEqual(['"VP R&D"', "CTO"]);
  });

  it("trims, drops blanks, and returns [] for no real titles", () => {
    expect(parseSearchTitles("  ceo , , cto ")).toEqual(["ceo", "cto"]);
    expect(parseSearchTitles("  , ,")).toEqual([]);
    expect(parseSearchTitles("")).toEqual([]);
  });

  it("returns [] when every title is non-ASCII", () => {
    expect(parseSearchTitles('מנכ"ל, סמנכ"ל')).toEqual([]);
  });

  it("each title feeds buildSearchUrl as a single-title keyword alongside the company facet", () => {
    const [first] = parseSearchTitles('CEO, CTO, מנכ"ל');
    const url = new URL(
      buildSearchUrl(
        { keywords: first, geoUrn: "", companyIds: ["163594"], network: ["S", "O"] },
        1,
      ),
    );
    expect(url.searchParams.get("keywords")).toBe("CEO");
    expect(url.searchParams.get("currentCompany")).toBe('["163594"]');
    expect(url.searchParams.get("network")).toBe('["S","O"]');
  });
});
