/**
 * Is the link a gift, or a farm reprint? A message handed to a bank or insurance
 * executive is a forward of something real; the 2026-08-26 Gil Tamir draft handed him
 * streamlinefeed.co.ke, a content farm reprinting someone else's reporting.
 *
 * Pure. No prisma, no LLM. Three named classes plus a catch-all:
 *   - search_wrapper: a search-engine host — never an article, reuses isSearchEngineHost.
 *   - aggregator: a named blocklist, plus a "farm shape" (the host's own name says what
 *     it is — feed/rss/aggregat/newswire/syndicat).
 *   - publisher: a named allowlist of outlets we already trust to send.
 *   - unknown: everything else. Deliberately NOT a rejection — see rejectsAsGift.
 */
import { isSearchEngineHost } from "@/lib/news/canonical-url";

export type SourceClass = "publisher" | "aggregator" | "search_wrapper" | "unknown";

/** Alphabetized, no comment noise. */
const AGGREGATOR_HOSTS = [
  "businesswire.com",
  "feedburner.com",
  "flipboard.com",
  "globenewswire.com",
  "msn.com",
  "news.google.com",
  "news.yahoo.com",
  "prnewswire.com",
];

/** Subdomain-only — the platform, not every blog that happens to share its name. */
const AGGREGATOR_HOST_SUFFIXES = [".blogspot.com"];

/**
 * A host whose registrable name says what it is — the farm itself (streamlinefeed
 * contains "feed") and any future press-release wire or syndication host without
 * naming every one individually.
 */
const AGGREGATOR_NAME_SHAPES = ["aggregat", "feed", "newswire", "rss", "syndicat"];

/** Israeli, then global. Alphabetized within each group, no comment noise. */
const PUBLISHER_HOSTS = [
  "bizportal.co.il",
  "calcalist.co.il",
  "davar1.co.il",
  "financeisrael.co.il",
  "geektime.co.il",
  "globes.co.il",
  "haaretz.co.il",
  "ice.co.il",
  "mako.co.il",
  "now14.co.il",
  "sponser.co.il",
  "themarker.com",
  "ynet.co.il",
  "americanbanker.com",
  "bloomberg.com",
  "cnbc.com",
  "coindesk.com",
  "economist.com",
  "finextra.com",
  "ft.com",
  "insurancejournal.com",
  "reuters.com",
  "techcrunch.com",
  "theregister.com",
  "theverge.com",
  "venturebeat.com",
  "wired.com",
  "wsj.com",
  "zdnet.com",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return (url ?? "").trim().toLowerCase();
  }
}

function stripWww(host: string): string {
  return host.replace(/^www\./, "");
}

/** True on an exact match or any subdomain — "www." and "edition." both count. */
function hostMatchesAny(host: string, registrableNames: string[]): boolean {
  const bare = stripWww(host);
  return registrableNames.some((d) => bare === d || bare.endsWith(`.${d}`));
}

export function classifySource(url: string): { cls: SourceClass; host: string; reason: string } {
  const host = hostOf(url);
  const bare = stripWww(host);

  if (hostMatchesAny(host, AGGREGATOR_HOSTS) || AGGREGATOR_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { cls: "aggregator", host, reason: `blocklisted aggregator: ${bare}` };
  }
  const shape = AGGREGATOR_NAME_SHAPES.find((s) => bare.includes(s));
  if (shape) {
    return { cls: "aggregator", host, reason: `aggregator-shaped host (contains "${shape}"): ${bare}` };
  }
  if (isSearchEngineHost(host)) {
    return { cls: "search_wrapper", host, reason: `search-engine host: ${bare}` };
  }
  if (hostMatchesAny(host, PUBLISHER_HOSTS)) {
    return { cls: "publisher", host, reason: `recognized publisher: ${bare}` };
  }
  return { cls: "unknown", host, reason: `unrecognized host: ${bare}` };
}

/**
 * True for `aggregator` and `search_wrapper` ONLY. Ruling from the controller: an
 * `unknown` host PASSES and gets reported, so the allowlist grows from evidence
 * instead of guesses — never reject an unknown host outright.
 */
export function rejectsAsGift(url: string): boolean {
  const { cls } = classifySource(url);
  return cls === "aggregator" || cls === "search_wrapper";
}
