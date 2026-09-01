/**
 * Pull one industry's source pack. The free half of the radar's intake.
 *
 * This replaces axes→queries→six providers as the backbone (lib/tech-radar/queries.ts +
 * fetch-pool-news.ts). The reason is measured, not aesthetic: on 2026-08-31 serper,
 * serpapi and tavily were all at 0 remaining for the month, so Bank Hapoalim's employer
 * research ran on five news items and its "recent moves" were dated 2024. RSS costs
 * nothing per call and has no monthly counter, so what the radar can SEE stops being a
 * function of the budget.
 *
 * NO reserveNewsCall here, deliberately. Gating this path would throttle the thing that
 * exists to replace the throttled thing. The module's imports are kept metered-free for
 * the same reason — canonical-url and freshness are pure, google-news-rss is free and
 * keyless (its own doc comment says so), and the dedupe key below is spelled out locally
 * rather than imported from fetch-topic-news precisely so that no paid provider module is
 * pulled in behind it. A test greps this file for `reserveNewsCall`.
 *
 * Two ways in per source, in order:
 *   1. The outlet's own RSS, when `PackSource.rss` is known.
 *   2. The site-restricted Google News feed, which works on ANY domain — that is what
 *      makes "10 + 10 outlets per industry" achievable without hunting 20 feed paths.
 *      The fallback also catches a source whose feed URL turns out to be wrong, because
 *      a 404 that merely records an error is a silent recall loss: it reads like a quiet
 *      week (the exact shape of the 2026-08-27 Google News incident).
 *
 * The Google News path DELEGATES to lib/news/google-news-rss.ts instead of fetching and
 * parsing news.google.com/rss/search here. That module documents why: since 2026-08 the
 * wrapper token is opaque binary with no embedded URL, so a hand-rolled parser recovers
 * nothing and drops 100% of the feed while looking like an empty week. Resolving a token
 * takes two extra HTTP requests, which that module already implements, bounds and reports
 * on. googleNewsSiteFeedUrl is still the canonical spelling of the feed a source is pulled
 * through — it is what the report and the editing screen show — and it is the URL the
 * delegate reconstructs from the same query.
 *
 * Never throws: one dead outlet cannot cost the other nineteen.
 */
import type { NewsResult } from "@/lib/news/types";
import { canonicalizeSourceUrl, isSearchEngineHost } from "@/lib/news/canonical-url";
import { ISRAEL_LOCALE, type QueryLocale } from "@/lib/news/locale";
import { fetchGoogleNewsRss } from "@/lib/news/google-news-rss";
import { FRESHNESS_WINDOW_DAYS } from "@/lib/tech-radar/freshness";
import type { PackSource, SourcePack } from "@/lib/tech-radar/sources";

/** One article, as it leaves the intake stage. `sourceHost` is the PACK source that
 *  produced it, not the URL's host — a Google News fallback resolves to the publisher, and
 *  the report has to be able to say which of the twenty outlets is earning its place. */
export type SourceItem = {
  title: string;
  url: string;
  snippet: string;
  /** ISO, or null when the feed carried no date. NEVER invented: the freshness gate
   *  (lib/tech-radar/freshness.ts) rejects an undated item, and a stamped-at-fetch-time
   *  date would smuggle stale items past a gate whose whole job is to stop them. */
  publishedAt: string | null;
  sourceHost: string;
};

export type SourceFetchReport = {
  host: string;
  name: string;
  /** Items this source CONTRIBUTED, counted before the cross-source dedupe — the
   *  fetch-pool-news precedent: an outlet gets credit for what it found even when
   *  another outlet filed the same story first. The counts therefore do not sum to
   *  `items.length`. */
  items: number;
  via: "rss" | "google-news";
  /** The feed actually asked for (or, on the fallback, its canonical spelling). */
  feedUrl: string;
  /** Set only when the source ended with ZERO items and something went wrong — the
   *  difference between "this outlet is quiet" and "this outlet is broken". */
  error?: string;
  /** Links dropped because they stayed on a search-engine host after canonicalization,
   *  i.e. an unresolvable redirect wrapper. Reported rather than swallowed: silently
   *  dropping these is how 100% of one provider's results vanished on 2026-08-27. */
  wrapperDrops?: number;
};

export type SourcePackFetch = { items: SourceItem[]; perSource: SourceFetchReport[] };

export type FetchSourcesDeps = {
  /** Returns the body, or null when the feed could not be read (non-2xx, empty, timeout).
   *  Injected so no test ever touches the network. */
  fetchText?: (url: string) => Promise<string | null>;
  /** The Google News fallback. Injected for the same reason.
   *  `locale` is passed EXPLICITLY off `source.lang` — see pullOne. */
  fetchGoogleNews?: (
    query: string,
    opts: { days: number; max: number; locale: QueryLocale | null }
  ) => Promise<NewsResult[]>;
  /** Sources pulled in parallel. Twenty feeds at once from one IP invites throttling for
   *  no gain — the pull is weekly. */
  concurrency?: number;
  /** Per-source ceiling. A prolific outlet must not be able to fill the 200-item pool cap
   *  on its own; the per-source round-robin downstream assumes a comparable supply. */
  maxPerSource?: number;
};

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_MAX_PER_SOURCE = 25;
const FEED_TIMEOUT_MS = 10_000;
/** Snippets feed the triage prompt, and 25 items per chunk share a token budget. A feed
 *  description is often the whole article; the first few sentences are what classify it. */
const SNIPPET_MAX = 500;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** CDATA off, entities decoded, HTML stripped, whitespace collapsed. Feed text is written
 *  for a reader, not a parser: publishers ship markup inside <description> routinely. */
function cleanText(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const cdata = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  const inner = (cdata ? cdata[1] : trimmed).trim();
  return decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const ms = Date.parse(cleanText(raw));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export type ParsedFeedItem = { title: string; url: string; snippet: string; publishedAt: string | null };

/**
 * Hand-rolled rather than a new XML dependency, same call as lib/news/google-news-rss.ts:
 * the shape needed is narrow and fixed. Both RSS 2.0 (<item>) and Atom (<entry>) are read
 * because several Israeli outlets serve Atom, and a parser that understood only one of
 * them would report zero items — indistinguishable from a quiet week.
 *
 * Pure. Nothing is filtered here: no date window, no host rules. Callers own those, and a
 * parser that dropped rows on its own would hide what the feed actually said.
 */
export function parseFeed(xml: string): ParsedFeedItem[] {
  const out: ParsedFeedItem[] = [];
  const blockRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml))) {
    const block = m[2];
    const title = cleanText(tag(block, "title") ?? "");
    // Atom puts the URL in an attribute; RSS puts it in the element body. rel="alternate"
    // (or no rel at all) is the article — rel="self"/"edit" point back at the feed.
    const linkEl = tag(block, "link");
    let url = linkEl ? cleanText(linkEl) : "";
    if (!url) {
      const hrefs = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((x) => x[1]);
      const alternate = hrefs.find((a) => !/\brel\s*=\s*"(?!alternate)/i.test(a));
      url = alternate?.match(/href\s*=\s*"([^"]+)"/i)?.[1]?.trim() ?? "";
    }
    if (!url) continue;
    const snippet = cleanText(tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content") ?? "").slice(
      0,
      SNIPPET_MAX
    );
    const publishedAt =
      toIso(tag(block, "pubDate")) ?? toIso(tag(block, "published")) ?? toIso(tag(block, "updated")) ?? null;
    out.push({ title, url, snippet, publishedAt });
  }
  return out;
}

/**
 * The site-restricted Google News feed for one source — the plan's fallback URL, spelled
 * with the source's own locale so an Israeli outlet is asked for in Hebrew (`IL:he`). The
 * 2026-08-26 run found 200 items and ZERO Israeli sources because nothing ever asked for
 * Israeli results; the locale is that fix carried into the pack path.
 *
 * `newsQuery` overrides the bare `site:` restriction for a source with no section feed
 * (Forbes, S&P Global): pulling an entire general-interest outlet would spend triage
 * tokens on sport.
 *
 * NOTE the delegate caveat: fetchGoogleNewsRss re-derives the locale from the query text
 * (localeForQuery — Hebrew letters mean Israel), so a bare ASCII `site:globes.co.il`
 * reaches Google on the US locale. The `site:` restriction is what actually bounds the
 * results to that outlet, so this costs ranking, not the domain; where the Hebrew section
 * term matters, `newsQuery` carries it and the locale follows for free.
 */
export function googleNewsSiteFeedUrl(source: PackSource): string {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", googleNewsQuery(source));
  const locale = localeForSource(source);
  if (locale) {
    url.searchParams.set("hl", locale.rssHl);
    url.searchParams.set("gl", locale.rssGl);
    url.searchParams.set("ceid", locale.rssCeid);
  } else {
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
  }
  return url.toString();
}

function googleNewsQuery(source: PackSource): string {
  return source.newsQuery ?? `site:${source.host}`;
}

/** The single source of truth for a source's market, used by BOTH the reported feed URL
 *  and the request. Two places deriving this independently is how they drifted apart. */
function localeForSource(source: PackSource): QueryLocale | null {
  return source.lang === "he" ? ISRAEL_LOCALE : null;
}

/** Default reader: body on 2xx, null on anything else. Never throws for a non-2xx —
 *  only a genuine transport failure propagates, and the caller records that as the error. */
async function defaultFetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

/**
 * Cross-source dedupe key: https, lowercased host without www, tracking params already
 * gone (canonicalizeSourceUrl does that), no trailing slash. The query string is KEPT —
 * several Israeli outlets identify a story by `?id=`, and dropping it would merge
 * unrelated articles into one.
 *
 * Spelled out here rather than imported from fetch-topic-news so this module pulls in no
 * metered provider; upsertTechItem still applies its own story-level key later, so the
 * two paths cannot disagree about what a story is where it matters.
 */
function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.host = u.host.replace(/^www\./i, "").toLowerCase();
    u.hash = "";
    return u.toString().replace(/\/(\?|$)/, (_, tail: string) => (tail === "?" ? "?" : ""));
  } catch {
    return url.trim().toLowerCase();
  }
}

type Pulled = { items: ParsedFeedItem[]; via: "rss" | "google-news"; feedUrl: string; errors: string[] };

async function pullOne(source: PackSource, deps: Required<Pick<FetchSourcesDeps, "fetchText" | "fetchGoogleNews" | "maxPerSource">>): Promise<Pulled> {
  const errors: string[] = [];

  if (source.rss) {
    try {
      const body = await deps.fetchText(source.rss);
      if (!body) errors.push(`RSS ${source.rss}: empty or non-2xx`);
      else {
        const parsed = parseFeed(body);
        if (parsed.length > 0) return { items: parsed.slice(0, deps.maxPerSource), via: "rss", feedUrl: source.rss, errors };
        errors.push(`RSS ${source.rss}: no items parsed`);
      }
    } catch (e) {
      errors.push(`RSS ${source.rss}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Fallback — also reached when a known-looking feed URL turns out to be wrong. See the
  // module doc comment for why this delegates instead of parsing the feed here.
  const feedUrl = googleNewsSiteFeedUrl(source);
  try {
    // The locale comes off the source's DECLARED language, never off the query text.
    // This is the line that closes the gap the module note above warned about: the feed
    // URL googleNewsSiteFeedUrl reports and the request actually sent now carry the same
    // market. Before it, a bare ASCII `site:calcalist.co.il` went out on hl=en-US and came
    // back with 2017-2024 items that the freshness gate then dropped to zero — which is
    // what made five of the ten Israeli sources look silent on 2026-09-01.
    const results = await deps.fetchGoogleNews(googleNewsQuery(source), {
      days: FRESHNESS_WINDOW_DAYS,
      max: deps.maxPerSource,
      locale: localeForSource(source),
    });
    const items = results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet ?? "",
      publishedAt: r.publishedAt ?? null,
    }));
    if (items.length === 0) errors.push(`Google News ${googleNewsQuery(source)}: no results`);
    return { items: items.slice(0, deps.maxPerSource), via: "google-news", feedUrl, errors };
  } catch (e) {
    errors.push(`Google News ${googleNewsQuery(source)}: ${e instanceof Error ? e.message : String(e)}`);
    return { items: [], via: "google-news", feedUrl, errors };
  }
}

/**
 * Pull every enabled source in the pack, in pack order, and dedupe across them.
 *
 * Returns per-source counts as well as items: "0 נמצאו" with no per-source breakdown is
 * the report this codebase has been burned by more than once — an empty pull must be able
 * to say WHICH outlet went quiet.
 */
export async function fetchSourcePack(pack: SourcePack, deps: FetchSourcesDeps = {}): Promise<SourcePackFetch> {
  const resolved = {
    fetchText: deps.fetchText ?? defaultFetchText,
    fetchGoogleNews:
      deps.fetchGoogleNews ??
      ((q: string, o: { days: number; max: number; locale: QueryLocale | null }) => fetchGoogleNewsRss(q, o)),
    maxPerSource: deps.maxPerSource ?? DEFAULT_MAX_PER_SOURCE,
  };
  const enabled = pack.sources.filter((s) => s.enabled);

  const pulls = await mapWithConcurrency(enabled, deps.concurrency ?? DEFAULT_CONCURRENCY, (s) => pullOne(s, resolved));

  const items: SourceItem[] = [];
  const seen = new Set<string>();
  const perSource: SourceFetchReport[] = [];

  for (let i = 0; i < enabled.length; i += 1) {
    const source = enabled[i];
    const pull = pulls[i];
    let contributed = 0;
    let wrapperDrops = 0;

    for (const raw of pull.items) {
      // Canonicalized at the door. Providers and feeds alike hand back search-engine
      // redirect wrappers, and on 2026-08-24 one reached a real person as
      // google.com/goto?url=CAESvQEB… — the fix belongs where the URL enters, because
      // every later stage reproduces the link verbatim by design.
      const url = canonicalizeSourceUrl(raw.url);
      if (!url || isSearchEngineHost(url)) {
        // An unwrappable wrapper: skipped, never forwarded, and COUNTED so a format
        // change shows up as a number instead of as an empty week.
        wrapperDrops += 1;
        continue;
      }
      contributed += 1;
      const key = dedupeKey(url);
      if (seen.has(key)) continue; // same story from an earlier source in pack order
      seen.add(key);
      items.push({
        title: raw.title,
        url,
        snippet: raw.snippet,
        publishedAt: raw.publishedAt,
        sourceHost: source.host,
      });
    }

    perSource.push({
      host: source.host,
      name: source.name,
      items: contributed,
      via: pull.via,
      feedUrl: pull.feedUrl,
      // Errors are only interesting when nothing came through: a source that fell back to
      // Google News and got its items is working, and reporting the failed first attempt
      // as an error would train the reader to ignore the column.
      ...(contributed === 0 && pull.errors.length > 0 ? { error: pull.errors.join("; ") } : {}),
      ...(wrapperDrops > 0 ? { wrapperDrops } : {}),
    });
  }

  return { items, perSource };
}
