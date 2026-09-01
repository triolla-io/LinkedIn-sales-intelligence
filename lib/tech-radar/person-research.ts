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
import { fetchGoogleNewsRss } from "@/lib/news/google-news-rss";
import { readPage as defaultReadPage } from "@/lib/research/read-page";
import type { NewsResult } from "@/lib/news/types";

export type PersonResearchInput = {
  fullName: string;
  hebrewName?: string | null;
  companyName: string;
};

/**
 * Does this result actually talk about the PERSON, or just about their employer?
 *
 * The 2026-09-01 prod probe is why this exists. `Contact` stores only `hebrewFirstName`, so
 * the Hebrew queries carry one given name, and a lone given name cannot be quoted as a
 * phrase without matching every Pazit in Israel — but unquoted it lets the company name
 * dominate instead, and the provider happily returns the employer's own press. Pazit
 * Garfinkel's six queries came back with eight results of which none named her: a children's
 * financial-literacy launch, a comedian's campaign, and a book publisher. Elinor Levinson
 * Gafni's eight were Wikipedia, a stock forecast, Q2 slides and a hospital statement.
 *
 * Handing those to the build is WORSE than handing it nothing: the prompt reads person
 * research as layer-4 FOUND evidence about the human and quotes it as such, so generic
 * employer news arrives wearing the person's name. A loud zero is the better answer, which
 * is what `noResearch` in the build report is for.
 *
 * Deterministic and free — no model decides this. A result is kept when the title or the
 * snippet names the person: the full English name, their surname, or the Hebrew given name.
 */
export function namesThePerson(
  text: string,
  input: Pick<PersonResearchInput, "fullName" | "hebrewName">
): boolean {
  const hay = text.toLowerCase();
  const en = input.fullName.trim().toLowerCase();
  if (en && hay.includes(en)) return true;
  // The surname alone: Israeli press writes "גרפינקל" and English coverage "Rachmil said",
  // without repeating the given name. Two characters is not a surname, it is a preposition.
  const surname = en.split(/\s+/).filter((w) => w.length > 2).at(-1);
  if (surname && hay.includes(surname)) return true;
  // A Hebrew GIVEN NAME on its own is not identification, and the 2026-09-01 probe proved
  // it in the two most embarrassing ways available: "גיל" matched `גילאי 5+` in a toy
  // advert, and "ארז" matched a Globes story about Erez YOSEF leaving Bank Hapoalim — a
  // different executive at the right company, which is the single most dangerous kind of
  // false positive here, because everything downstream would have read it as Erez Rachmil's
  // own career move. Only a FULL Hebrew name (given + family) is accepted.
  const he = (input.hebrewName ?? "").trim();
  if (/\s/.test(he) && he.length > 4 && text.includes(he)) return true;
  return false;
}

export type PersonWebResearch = {
  findings: { title: string; url: string; snippet: string; pageText: string | null }[];
  /** The queries actually run. On the report, so an empty result can name what was asked. */
  queries?: string[];
  /** How many PAID queries the top-up spent. 0 means the whole research was free. */
  paidQueries?: number;
  /**
   * Results that came back but named only the employer, never the person. A high number
   * here beside `findings: 0` is a recall problem worth reading; it used to be invisible
   * because every one of them was passed to the build as evidence about the human.
   */
  discarded?: number;
};

/**
 * Six queries, and the first two are ROLE-shaped rather than event-shaped.
 *
 * Four was the budget while every query presupposed a press event — interview, panel,
 * keynote. That is a far narrower net than "what does this person actually do", and on
 * 2026-09-01 the cost of the difference was measured: Pazit Garfinkel's entire agenda is
 * public and named — the "בנקאות יוזמת" strategy, פועלים PRO, פועלים ג'וניור, the CAL
 * card-operating agreement — and not one of the four event queries reached any of it,
 * while a plain "במה מתעסקת" returned all of it at once.
 */
const MAX_QUERIES = 6;
/** How many results reach the build prompt. Beyond this the tail is noise. */
const MAX_FINDINGS = 8;
/** Each read is a live HTTP fetch (or a metered Tavily Extract call) — this is the budget. */
const DEFAULT_MAX_PAGE_READS = 4;
/** Per-finding text budget: enough of an interview to be quotable, small enough that
 *  eight findings still fit one prompt. */
const MAX_PAGE_TEXT_CHARS = 4000;
/** Google News RSS results per query. Free, so this cap is about prompt size, not cost. */
const RSS_MAX_PER_QUERY = 10;
/**
 * Below this many free findings, spend a paid call; above it, the paid pool buys research
 * nothing it does not already have. Person research is not what a month's quota should die
 * on — and on 2026-08-31 it died the other way round: three of four paid providers were at
 * exactly zero, this module ran only on them, and v3's flagship new input returned nothing
 * for the four people it was built for.
 */
const MIN_FINDINGS_BEFORE_PAID = 4;

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
  // The Hebrew name is quoted as a PHRASE only when it is a full name. `Contact` stores
  // only `hebrewFirstName`, and the caller passes exactly that — so until 2026-09-01 the
  // Hebrew half of the budget ran as `"פזית" Bank Hapoalim ראיון` and `"פזית" כנס`: a
  // quoted lone first name, which matches every Pazit in Israel and pins nothing. A single
  // token is therefore used UNQUOTED and always beside the company, so a provider still has
  // to satisfy both — and `currentCompany` carries the Hebrew company name for Israeli
  // employers ("Bank Hapoalim בנק הפועלים"), which is what makes that pairing land.
  const heName = he ? (/\s/.test(he) ? `"${he}"` : he) : "";
  // ROLE-SHAPED FIRST, and first for a reason: these are the queries that answer "what
  // does this person own", and they run before the budget can be eaten by event queries.
  // An executive's areas of responsibility are written up far more often than their
  // conference appearances are.
  const role = he
    ? [`${heName} ${company} תחומי אחריות`, `${heName} ${company} אסטרטגיה`]
    : [`"${en}" ${company} responsibilities`, `"${en}" ${company} strategy`];
  // Hebrew doubles the recall for Israeli executives, whose press coverage is almost
  // entirely Hebrew. With no Hebrew name to search, that budget buys English breadth
  // instead rather than going unspent.
  const events = he
    ? [`${heName} ${company} ראיון`, `${heName} ${company} כנס`, `"${en}" ${company} interview`, `"${en}" ${company} conference panel`]
    : [`"${en}" ${company} interview`, `"${en}" ${company} conference panel`, `"${en}" ${company} keynote`];
  return [...role, ...events].slice(0, MAX_QUERIES);
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
    /** The PAID pool's fetcher (top-up only — see MIN_FINDINGS_BEFORE_PAID). */
    fetcher?: (
      query: string
    ) => Promise<{ title: string; url: string; snippet: string; source: string; publishedAt: string | null }[]>;
    /** The FREE Google News RSS fetcher, which is now the primary. Injected in tests. */
    rssFetcher?: (query: string) => Promise<NewsResult[]>;
    readPage?: typeof defaultReadPage;
    maxPageReads?: number;
    /** Pacing between pooled queries; forwarded to fetchPoolNews. Tests pass a no-op. */
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<PersonWebResearch> {
  const readPage = deps.readPage ?? defaultReadPage;
  const maxReads = Math.max(0, deps.maxPageReads ?? DEFAULT_MAX_PAGE_READS);

  const queries = buildPersonResearchQueries(input);

  // FREE FIRST. Google News RSS has no quota to exhaust, and by rule 1 above nothing found
  // here is ever forwarded to anybody — so there was never a reason for the one input that
  // makes a person model personal to be the input that runs out of money.
  // Both defaults reach the network, so under vitest a caller that forgot a seam gets an
  // empty result instead of a live pull. The phase's standing constraint is "never make a
  // real network call to a news provider in a test", and a constraint enforced only by
  // everyone remembering it is enforced by nothing — the first caller to forget it here
  // did not get a clear failure, it got a 5-second timeout AND a live call against a
  // provider whose monthly quota is already at zero. A test that means to exercise
  // research injects the seam and neither branch below runs.
  const inTest = !!process.env.VITEST;
  const rss =
    deps.rssFetcher ??
    (inTest ? async () => [] : (query: string) => fetchGoogleNewsRss(query, { max: RSS_MAX_PER_QUERY }));
  const collected: NewsResult[] = [];
  for (const query of queries) {
    collected.push(...(await rss(query)));
  }

  // Paid top-up only when free came back thin.
  //
  // No company subscriptions: this pool is one person's, so nothing is shared across
  // companies the way a scan's pool is.
  // The top-up decision is made on results that NAME THE PERSON, not on raw result count.
  // Eight results about the employer are not four results about the human, and the whole
  // point of spending a paid query is to find the human.
  const namedSoFar = () =>
    dedupeByUrl(collected).filter((i) => namesThePerson(`${i.title} ${i.snippet ?? ""}`, input)).length;

  let paidQueries = 0;
  if (namedSoFar() < MIN_FINDINGS_BEFORE_PAID && (deps.fetcher || !inTest)) {
    const pool = queries.map((query) => ({ query, companyIds: [] as string[] }));
    const news = await fetchPoolNews(pool, deps.fetcher, deps.sleep ? { sleep: deps.sleep } : {});
    collected.push(...news.items);
    paidQueries = pool.length;
  }

  // Dedupe by normalised URL — the same interview is found by three of the six queries, and
  // now by two providers on top of that. Same rule as persist.ts's normalizeStoryUrl,
  // duplicated rather than imported because that module pulls in prisma and this one is
  // deliberately injectable for tests.
  const unique = dedupeByUrl(collected);
  const named = unique.filter((item) => namesThePerson(`${item.title} ${item.snippet ?? ""}`, input));

  const findings: PersonWebResearch["findings"] = [];
  let reads = 0;
  for (const item of named.slice(0, MAX_FINDINGS)) {
    let pageText: string | null = null;
    if (reads < maxReads && (deps.readPage || !inTest)) {
      reads += 1;
      const page = await readPage(item.url);
      if (page?.text) pageText = page.text.slice(0, MAX_PAGE_TEXT_CHARS);
    }
    findings.push({ title: item.title, url: item.url, snippet: item.snippet ?? "", pageText });
  }

  return { findings, queries, paidQueries, discarded: unique.length - named.length };
}

/** Scheme, www, trailing slash and case are noise; the host+path is the story. */
function dedupeByUrl(items: NewsResult[]): NewsResult[] {
  const seen = new Set<string>();
  const out: NewsResult[] = [];
  for (const item of items) {
    let key: string;
    try {
      const u = new URL(item.url);
      key = `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {
      key = item.url.trim().toLowerCase();
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
