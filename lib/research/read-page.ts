/**
 * Page reading — a capability this repo did not previously have.
 *
 * The news providers return a title and a snippet, and
 * lib/enrichment/openrouter-search.ts is training-data based despite its name.
 * Deep research needs the real text of a page, so this module supplies it.
 *
 * Two paths in descending order of quality:
 *   1. Tavily Extract — clean text, same provider/key already in use, and gated
 *      by reserveNewsCall("tavily") because it draws on the same free quota.
 *   2. Plain fetch + HTML stripping — the fallback when Extract is unavailable,
 *      out of quota, or fails.
 *
 * It NEVER throws. An unreadable page returns null: one blocked page out of
 * eight must not fail a company's research. Errors are the normal case here.
 */
import { reserveNewsCall } from "@/lib/news/budget";
import { MAX_PAGE_READS_PER_RUN } from "@/lib/tech-radar/types";

export const MAX_PAGE_CHARS = 8000;
const TIMEOUT_MS = 10_000;
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

export type PageContent = {
  url: string;
  title: string | null;
  text: string;
  /**
   * Where the fetch actually LANDED after following redirects — the article's own
   * address, when the requested URL was a redirect wrapper. Equal to `url` when the
   * path taken cannot know (Tavily Extract, or a response that does not say).
   */
  finalUrl: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', middot: "·", bull: "•",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Pure HTML -> { title, text }. Exported so it can be tested without a network. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() || null : null;

  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      // Block-level tags become newlines first so words don't get glued together.
      .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text };
}

/** Only http(s) is fetchable; anything else is rejected without a request. */
function isFetchableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function viaTavilyExtract(url: string): Promise<PageContent | null> {
  const key = (process.env.TAVILY_API_KEY ?? "").trim();
  if (!key) return null;
  if (!(await reserveNewsCall("tavily"))) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TAVILY_EXTRACT_URL, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, urls: [url] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.results) ? data.results : [];
    const first = rows[0] as Record<string, unknown> | undefined;
    const raw = typeof first?.raw_content === "string" ? first.raw_content.trim() : "";
    if (!raw) return null;
    return { url, title: null, text: raw.slice(0, MAX_PAGE_CHARS), finalUrl: url };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function viaPlainFetch(url: string): Promise<PageContent | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TriollaTechRadar/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers?.get?.("content-type") ?? "";
    // A PDF or image would produce garbage text; only markup is useful here.
    if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) return null;
    const body = await res.text();
    const { title, text } = htmlToText(body);
    if (!text) return null;
    const landed = typeof res.url === "string" && res.url ? res.url : url;
    return { url, title, text: text.slice(0, MAX_PAGE_CHARS), finalUrl: landed };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Read one page. Returns null on ANY failure — never throws. */
export async function readPage(url: string): Promise<PageContent | null> {
  if (!isFetchableUrl(url)) return null;
  const extracted = await viaTavilyExtract(url);
  if (extracted) return extracted;
  return viaPlainFetch(url);
}

/** Read up to `limit` pages, dropping the ones that fail. Never throws. */
export async function readPages(
  urls: string[],
  opts: { limit?: number } = {}
): Promise<PageContent[]> {
  const limit = Math.max(0, opts.limit ?? MAX_PAGE_READS_PER_RUN);
  const out: PageContent[] = [];
  for (const url of urls.slice(0, limit)) {
    const page = await readPage(url);
    if (page) out.push(page);
  }
  return out;
}
