/** LinkedIn geo URN for "Israel". VERIFY against live LinkedIn before trusting blindly. */
export const ISRAEL_GEO_URN = "101620260";

/** "S" = 2nd-degree network filter in LinkedIn people search. */
const SECOND_DEGREE = "S";

/**
 * Build a LinkedIn people-search URL pinned to 2nd-degree connections in Israel.
 * `keywords` is the raw comma-separated string the user typed (e.g. "cto, vp r&d, ceo").
 */
export function buildSearchUrl(keywords: string, page: number): string {
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("network", `["${SECOND_DEGREE}"]`);
  url.searchParams.set("geoUrn", `["${ISRAEL_GEO_URN}"]`);
  url.searchParams.set("origin", "FACETED_SEARCH");
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}
