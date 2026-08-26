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
  const trimmed = (url ?? "").trim();
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    // No scheme — retry as if it had one, so a bare "www.example.com/rss/article"
    // still gets read as a HOST. Only if that also fails (not URL-shaped at all) do we
    // fall back to a best-effort split, which at least drops the path/query rather
    // than matching farm-shape words against them.
    try {
      return new URL(`https://${trimmed}`).hostname.toLowerCase();
    } catch {
      return trimmed.split(/[/?#]/)[0]?.toLowerCase() ?? "";
    }
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

/** Generic second-level labels that precede a two-letter country code, e.g. "co.il". */
const GENERIC_SLD_LABELS = new Set(["ac", "co", "com", "gov", "net", "or", "org"]);

function isTwoLetterCountryCode(label: string): boolean {
  return /^[a-z]{2}$/.test(label);
}

/**
 * The registrable domain's OWN label — "streamlinefeed" out of "streamlinefeed.co.ke",
 * "reuters" out of "feeds.reuters.com" — never a subdomain. Without this, the
 * farm-shape check below would classify a publisher's own "feeds." or "rss." subdomain
 * (real shapes: feeds.reuters.com, rss.calcalist.co.il) as an aggregator by matching
 * the subdomain label instead of the registrable name. No public-suffix list here —
 * just the "co"/generic + two-letter-country pattern our own publisher list actually
 * uses (co.il, co.ke, ...), falling back to the standard second-from-last label.
 */
function registrableLabel(bareHost: string): string {
  const labels = bareHost.split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const last = labels[labels.length - 1];
  const secondLast = labels[labels.length - 2];
  if (labels.length >= 3 && isTwoLetterCountryCode(last) && GENERIC_SLD_LABELS.has(secondLast)) {
    return labels[labels.length - 3];
  }
  return secondLast;
}

export function classifySource(url: string): { cls: SourceClass; host: string; reason: string } {
  const host = hostOf(url);
  const bare = stripWww(host);

  if (hostMatchesAny(host, AGGREGATOR_HOSTS) || AGGREGATOR_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { cls: "aggregator", host, reason: `blocklisted aggregator: ${bare}` };
  }
  // The allowlist runs BEFORE the farm-shape heuristic: a recognized outlet's own
  // subdomain (feeds.reuters.com, rss.calcalist.co.il) must never reach a substring
  // check that only exists to catch hosts we do NOT already trust.
  if (hostMatchesAny(host, PUBLISHER_HOSTS)) {
    return { cls: "publisher", host, reason: `recognized publisher: ${bare}` };
  }
  const shape = AGGREGATOR_NAME_SHAPES.find((s) => registrableLabel(bare).includes(s));
  if (shape) {
    return { cls: "aggregator", host, reason: `aggregator-shaped host (contains "${shape}"): ${bare}` };
  }
  if (isSearchEngineHost(host)) {
    return { cls: "search_wrapper", host, reason: `search-engine host: ${bare}` };
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
