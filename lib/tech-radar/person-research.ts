/**
 * Web research about the PERSON — interviews, conference panels, quotes in the press.
 *
 * New in v3. Until now a radar person model was built from `fullName` + `currentTitle` +
 * `headline` crossed with the EMPLOYER's profile, and nothing was ever searched about the
 * human being: a VP of Digital at a bank and a VP of Digital at an insurer produced the
 * same person, because the only thing the model ever read was the job title. This module
 * is the missing input.
 *
 * Two deliberate rules:
 *
 *   1. The feature's 20-source publisher whitelist does NOT apply here. That list exists
 *      to keep the gift — the article a real message links to — inside publishers worth
 *      being seen citing. This is research: a niche podcast transcript or a conference
 *      agenda is perfectly good evidence about what someone works on, and none of it is
 *      ever forwarded to anybody.
 *
 *   2. Queries are built deterministically in code, never phrased by an LLM. The live
 *      cause: an LLM-written query invented the employer name "בנק בינלאומי ראשון" for a
 *      person whose evidence never mentioned it, and that fabrication then went out in a
 *      search aimed at a real executive. See lib/tech-radar/queries.ts's module comment
 *      for the surrounding discipline.
 *
 * Never throws. Page reads are the real HTTP spend here and are capped; a page that will
 * not load simply leaves `pageText` null rather than dropping the finding, because the
 * title and snippet are still evidence.
 */
import { fetchPoolNews } from "@/lib/tech-radar/fetch-pool-news";
import { readPage as defaultReadPage } from "@/lib/research/read-page";

export type PersonResearchInput = {
  fullName: string;
  hebrewName?: string | null;
  companyName: string;
};

export type PersonWebResearch = {
  findings: { title: string; url: string; snippet: string; pageText: string | null }[];
};

/** Four queries is the whole search budget for one person. */
const MAX_QUERIES = 4;
/** How many results reach the build prompt. Beyond this the tail is noise. */
const MAX_FINDINGS = 8;
/** Each read is a live HTTP fetch (or a metered Tavily Extract call) — this is the budget. */
const DEFAULT_MAX_PAGE_READS = 4;
/** Per-finding text budget: enough of an interview to be quotable, small enough that
 *  eight findings still fit one prompt. */
const MAX_PAGE_TEXT_CHARS = 4000;

/**
 * The queries for one person, in code. Pure and deterministic — the same input always
 * produces the same list, which is what lets an Inngest step replay match and what keeps
 * an invented name from ever entering a search.
 *
 * The name is quoted so a provider matches the person rather than the two words
 * separately; the employer is left unquoted so a mention that spells the company slightly
 * differently still lands.
 */
export function buildPersonResearchQueries(input: PersonResearchInput): string[] {
  const en = input.fullName.trim();
  const he = (input.hebrewName ?? "").trim();
  const company = input.companyName.trim();
  const queries = [
    `"${en}" ${company} interview`,
    `"${en}" ${company} conference panel`,
    // Hebrew doubles the recall for Israeli executives, whose press coverage is almost
    // entirely Hebrew. With no Hebrew name to search, that budget buys English breadth
    // instead rather than going unspent.
    ...(he ? [`"${he}" ${company} ראיון`, `"${he}" כנס`] : [`"${en}" ${company} keynote`]),
  ];
  return queries.slice(0, MAX_QUERIES);
}

/**
 * Run the person's queries and read the top pages.
 *
 * `fetcher`, `readPage` and `sleep` are injection seams so tests never touch a provider:
 * a real news call here spends from a nearly-exhausted monthly quota.
 */
export async function researchPerson(
  input: PersonResearchInput,
  deps: {
    fetcher?: (
      query: string
    ) => Promise<{ title: string; url: string; snippet: string; source: string; publishedAt: string | null }[]>;
    readPage?: typeof defaultReadPage;
    maxPageReads?: number;
    /** Pacing between pooled queries; forwarded to fetchPoolNews. Tests pass a no-op. */
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<PersonWebResearch> {
  const readPage = deps.readPage ?? defaultReadPage;
  const maxReads = Math.max(0, deps.maxPageReads ?? DEFAULT_MAX_PAGE_READS);

  // No company subscriptions: this pool is one person's, so nothing is shared across
  // companies the way a scan's pool is. fetchPoolNews still dedupes by canonical URL,
  // which is what collapses the same interview found by three of the four queries.
  const pool = buildPersonResearchQueries(input).map((query) => ({ query, companyIds: [] as string[] }));
  const news = await fetchPoolNews(pool, deps.fetcher, deps.sleep ? { sleep: deps.sleep } : {});

  const findings: PersonWebResearch["findings"] = [];
  let reads = 0;
  for (const item of news.items.slice(0, MAX_FINDINGS)) {
    let pageText: string | null = null;
    if (reads < maxReads) {
      reads += 1;
      const page = await readPage(item.url);
      if (page?.text) pageText = page.text.slice(0, MAX_PAGE_TEXT_CHARS);
    }
    findings.push({ title: item.title, url: item.url, snippet: item.snippet ?? "", pageText });
  }

  return { findings };
}
