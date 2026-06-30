// LinkedIn people-search "network" facet values: F = 1st, S = 2nd, O = 3rd+.
// We target 2nd AND 3rd-degree (1st-degree are already connections; the filter skips them anyway).
const SECOND_DEGREE = "S";
const THIRD_DEGREE = "O";

export const GEO_URNS: Record<string, { label: string; urn: string }> = {
  IL: { label: "Israel", urn: "101620260" },
  US: { label: "United States", urn: "103644278" },
  GB: { label: "United Kingdom", urn: "101165590" },
  DE: { label: "Germany", urn: "101282230" },
  FR: { label: "France", urn: "105015875" },
  CA: { label: "Canada", urn: "101174742" },
  AU: { label: "Australia", urn: "101452733" },
  NL: { label: "Netherlands", urn: "102890719" },
  IN: { label: "India", urn: "102713980" },
  SG: { label: "Singapore", urn: "102454443" },
};

export const DEFAULT_GEO = "IL";

export function buildSearchUrl(keywords: string, page: number, geoUrn = GEO_URNS.IL.urn): string {
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("network", `["${SECOND_DEGREE}","${THIRD_DEGREE}"]`);
  url.searchParams.set("geoUrn", `["${geoUrn}"]`);
  url.searchParams.set("origin", "FACETED_SEARCH");
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}
