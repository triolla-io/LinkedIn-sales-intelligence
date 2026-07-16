// LinkedIn people-search "network" facet values: F = 1st, S = 2nd, O = 3rd+.
// We target 2nd-degree ONLY: 1st are already connections, and 3rd+ requests
// convert poorly, so the routine sticks to warm 2nd-degree prospects.
const SECOND_DEGREE = "S";

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

export type SearchUrlParams = {
  keywords: string;
  /** Empty string = worldwide (omit the geoUrn facet). Undefined = IL default. */
  geoUrn?: string;
  // LinkedIn Industry Codes V2 ids (see lib/prospecting/industries.ts). Empty/absent = all industries.
  industryIds?: string[];
  /** LinkedIn numeric company ids → currentCompany facet. Empty/absent = no company facet. */
  companyIds?: string[];
  /** Connection-degree facet override. Default: ["S"] (2nd degree only). */
  network?: string[];
};

/** A title is searchable on LinkedIn only if it's pure ASCII (see below). */
function isAsciiTitle(t: string): boolean {
  for (const ch of t) if (ch.charCodeAt(0) > 127) return false;
  return true;
}

/**
 * Split the COMPANY-run "titles" field (a comma list) into individual, query-ready
 * single titles — one LinkedIn people-search per title, results merged/deduped.
 *
 * We search ONE title at a time (not `CEO OR CTO OR …`) because LinkedIn's free URL
 * search does NOT reliably honor boolean `OR` across a title list — it returns zero
 * even when each title alone returns people. Single-title searches are reliable.
 *
 * Each returned title is phrase-wrapped when it has whitespace (`"VP R&D"`). Non-ASCII
 * (Hebrew) titles like `מנכ"ל` are dropped — LinkedIn URL search returns zero for them;
 * English titles cover the same execs.
 */
export function parseSearchTitles(titles: string): string[] {
  return titles
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter(isAsciiTitle)
    .map((t) => (/\s/.test(t) ? `"${t.replace(/"/g, "")}"` : t));
}

export function buildSearchUrl(params: SearchUrlParams, page: number): string {
  const {
    keywords,
    geoUrn = GEO_URNS[DEFAULT_GEO].urn,
    industryIds,
    companyIds,
    network,
  } = params;
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set(
    "network",
    JSON.stringify(network && network.length > 0 ? network : [SECOND_DEGREE]),
  );
  if (geoUrn !== "") {
    url.searchParams.set("geoUrn", `["${geoUrn}"]`);
  }
  if (industryIds && industryIds.length > 0) {
    url.searchParams.set("industry", JSON.stringify(industryIds));
  }
  if (companyIds && companyIds.length > 0) {
    url.searchParams.set("currentCompany", JSON.stringify(companyIds));
  }
  url.searchParams.set("origin", "FACETED_SEARCH");
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}
