import { describe, it, expect } from "vitest";
import { buildSearchUrl, GEO_URNS } from "@/lib/prospecting/search-url";
const ISRAEL_GEO_URN = GEO_URNS.IL.urn;

describe("buildSearchUrl", () => {
  it("encodes keywords and pins 2nd+3rd-degree + Israel filters", () => {
    const url = new URL(buildSearchUrl("cto, vp r&d, ceo", 1));
    expect(url.pathname).toBe("/search/results/people/");
    expect(url.searchParams.get("keywords")).toBe("cto, vp r&d, ceo");
    expect(url.searchParams.get("network")).toBe('["S","O"]');
    expect(url.searchParams.get("geoUrn")).toBe(`["${ISRAEL_GEO_URN}"]`);
    expect(url.searchParams.get("origin")).toBe("FACETED_SEARCH");
  });

  it("includes the page param only when page > 1", () => {
    expect(new URL(buildSearchUrl("ceo", 1)).searchParams.has("page")).toBe(false);
    expect(new URL(buildSearchUrl("ceo", 3)).searchParams.get("page")).toBe("3");
  });
});
