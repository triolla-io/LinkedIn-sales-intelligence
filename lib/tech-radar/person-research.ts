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
import { fetchSerperWeb } from "@/lib/news/serper";
import { readPage as defaultReadPage } from "@/lib/research/read-page";
import type { NewsResult } from "@/lib/news/types";

export type PersonResearchInput = {
  fullName: string;
  hebrewName?: string | null;
  companyName: string;
};

/**
 * Hebrew word mechanics, in one place, because both traps here are documented failures.
 *
 *   1. `\b` in JavaScript is defined on ASCII word characters, so a `\b`-anchored Hebrew
 *      pattern silently never fires — it does not error, it just quietly matches nothing.
 *      Every check below is anchored on Hebrew-letter lookaround instead.
 *   2. `includes` on a bare Hebrew name is the other trap: "לאומי" is a substring of
 *      "בינלאומי", and those are two different banks. Tokens are matched exactly.
 */
const HE_LETTER = "\u05D0-\u05EA";
const HE_TOKEN_RE = /[\u05D0-\u05EA]+/g;
/**
 * The one-letter prefixes ordinary Hebrew glues onto a noun: ב/ה/ו/כ/ל/מ/ש — "בלאומי" is
 * "at Leumi". Allowed in front of an EMPLOYER token only, and exactly one letter, so
 * "בינלאומי" still cannot satisfy "לאומי" (stripping one letter leaves "ינלאומי").
 *
 * Deliberately NOT allowed in front of a person's given name: "בגיל" is "at the age of",
 * and a given name matching inside `גילאי 5+` is one of the two false positives this
 * module was written to stop. A prefixed given name is real Hebrew and losing it costs a
 * little recall; the alternative costs the discipline.
 */
const HE_PREFIXES = "בהוכלמש";

/** Hebrew-letter runs only. Digits, Latin and punctuation are separators. */
function hebrewTokens(text: string): string[] {
  return text.match(HE_TOKEN_RE) ?? [];
}

/** This exact Hebrew token, no inflection and no prefix. */
function hasHebrewToken(text: string, token: string): boolean {
  if (token.length < 2) return false;
  return new RegExp(`(?<![${HE_LETTER}])${token}(?![${HE_LETTER}])`).test(text);
}

/** This exact Hebrew token, optionally behind ONE prefix letter. Employers only. */
function hasEmployerToken(text: string, token: string): boolean {
  if (token.length < 3) return false;
  return new RegExp(`(?<![${HE_LETTER}])[${HE_PREFIXES}]?${token}(?![${HE_LETTER}])`).test(text);
}

/** `first surname`, adjacent, whitespace only between them — never across punctuation. */
function hasHebrewNamePair(text: string, first: string, surname: string): boolean {
  if (first.length < 2 || surname.length < 2) return false;
  return new RegExp(`(?<![${HE_LETTER}])${first}[ \u00a0]+${surname}(?![${HE_LETTER}])`).test(text);
}

/**
 * Words that name a KIND of employer rather than an employer. "בנק" cannot be the half of
 * the pairing that proves anything — "בנקאות דיגיטלית" in an article title would satisfy it
 * — and neither can "ישראל", which names a country. An employer whose Hebrew name is
 * nothing but these words simply has no usable token, and the first-name pairing below
 * never fires for its people. That is the intended answer, not a gap to paper over.
 */
const GENERIC_COMPANY_TOKENS = new Set([
  "בנק", "הבנק", "בנקאות", "חברת", "חברה", "החברה", "קבוצת", "קבוצה", "הקבוצה",
  "ביטוח", "השקעות", "פיננסים", "בעמ", "ישראל", "הישראלית", "הישראלי",
]);

/**
 * The Hebrew tokens of an employer name that could identify it. Three letters minimum.
 *
 * HEBREW ONLY: an employer stored as "Bank Hapoalim" yields nothing here and the pairing
 * below can never fire for its people. That is not an oversight — it is the same thing the
 * query builder already relies on, `currentCompany` carrying both spellings ("Bank Hapoalim
 * בנק הפועלים"), and it is the field to fix when a person's coverage is all Hebrew.
 */
function employerTokens(companyName: string | null | undefined): string[] {
  return hebrewTokens((companyName ?? "").trim()).filter(
    (t) => t.length >= 3 && !GENERIC_COMPANY_TOKENS.has(t)
  );
}

function namesEmployer(text: string, tokens: string[]): boolean {
  return tokens.some((t) => hasEmployerToken(text, t));
}

/**
 * Words that follow a given name without being a surname: function words, the verbs the
 * press attributes quotes with, and job titles. Without this list "פזית מנהלת את האגף"
 * would nominate "מנהלת" as her family name on as many hosts as print it.
 */
const NOT_A_SURNAME = new Set([
  "של", "את", "עם", "על", "אל", "מן", "כי", "גם", "לא", "הוא", "היא", "הם", "הן", "זה",
  "זו", "אשר", "כדי", "אבל", "כאשר", "לפני", "אחרי", "כיום", "לשעבר", "החדש", "החדשה",
  "אמר", "אמרה", "אמרו", "ציין", "ציינה", "הודיע", "הודיעה", "מספר", "מספרת", "מסביר",
  "מסבירה", "מונה", "מונתה", "תוביל", "יוביל", "מובילה", "מוביל", "עוסק", "עוסקת",
  "הצטרף", "הצטרפה", "מנהל", "מנהלת", "מנכל", "מנכלית", "סמנכל", "סמנכלית", "ראש",
  "יור", "משנה", "נציג", "נציגה", "ממונה", "אחראי", "אחראית", "סגן", "סגנית",
]);

/**
 * Every token that sits immediately after the given name on this page — the candidates for
 * "what is her family name". Adjacency is on the RAW text with only spaces between, so a
 * comma ends the run: "פזית, מנהלת אגף" nominates nobody.
 */
function surnameCandidates(text: string, first: string, employer: string[]): string[] {
  if (first.length < 2) return [];
  const re = new RegExp(
    `(?<![${HE_LETTER}])${first}[ \u00a0]+([${HE_LETTER}]{2,})(?![${HE_LETTER}])`,
    "g"
  );
  const employerSet = new Set(employer);
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const cand = m[1];
    if (cand === first) continue;
    if (NOT_A_SURNAME.has(cand)) continue;
    // The employer's own tokens, with or without a glued prefix: "פזית בבנק הפועלים".
    const bare = HE_PREFIXES.includes(cand[0]) ? cand.slice(1) : cand;
    if (GENERIC_COMPANY_TOKENS.has(cand) || GENERIC_COMPANY_TOKENS.has(bare)) continue;
    if (employerSet.has(cand) || employerSet.has(bare)) continue;
    if (!out.includes(cand)) out.push(cand);
  }
  return out;
}

/** How many DIFFERENT hosts must agree before a learned surname is trusted at all. */
const MIN_SURNAME_HOSTS = 2;

export type HebrewSurnameSuggestion = {
  /** The family name the pages agree on. Extracted from real text, never transliterated. */
  surname: string;
  /** The full name this implies. A SUGGESTION for a human to confirm — see below. */
  hebrewFullName: string;
  /** One URL per agreeing host, so the human can read the evidence before confirming. */
  sources: string[];
  /** What the suggestion rests on. There is exactly one accepted basis. */
  basis: "two_independent_pages";
};

/**
 * Learn the Hebrew family name from the pages, the way a person reading the results would.
 *
 * `Contact.hebrewFullName` is hand-filled on purpose: a Hebrew spelling invented by a model
 * and then sent out in a search aimed at a real named executive is a fabrication, and this
 * repo has already paid for one ("בנק בינלאומי ראשון"). Transliteration is therefore not on
 * the table. But two independent pages that both print the same token immediately after her
 * given name are not an invention — they are evidence, and evidence may be SUGGESTED.
 *
 * Two rules keep it honest:
 *   - the same candidate on at least MIN_SURNAME_HOSTS DIFFERENT hosts. Two pages on one
 *     site are one newsroom repeating itself, which is one source, not two.
 *   - a tie is a refusal. If two candidates are equally attested we cannot tell which
 *     person the run is about, and guessing between them is exactly the fabrication.
 *
 * Nothing here writes to the database. The caller returns this to a human.
 */
export function learnHebrewSurname(
  pages: { url: string; text: string }[],
  opts: { hebrewFirstName: string; companyName?: string | null }
): HebrewSurnameSuggestion | null {
  const first = hebrewTokens(opts.hebrewFirstName.trim())[0] ?? "";
  if (first.length < 2) return null;
  const employer = employerTokens(opts.companyName);

  // candidate -> host -> the first URL seen on that host, kept as the citation.
  const byCandidate = new Map<string, Map<string, string>>();
  for (const page of pages) {
    let host: string;
    try {
      host = new URL(page.url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue; // no host, no independence claim
    }
    for (const cand of surnameCandidates(page.text, first, employer)) {
      const hosts = byCandidate.get(cand) ?? new Map<string, string>();
      if (!hosts.has(host)) hosts.set(host, page.url);
      byCandidate.set(cand, hosts);
    }
  }

  const ranked = [...byCandidate.entries()]
    .map(([surname, hosts]) => ({ surname, sources: [...hosts.values()] }))
    .filter((c) => c.sources.length >= MIN_SURNAME_HOSTS)
    .sort((a, b) => b.sources.length - a.sources.length);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[1].sources.length === ranked[0].sources.length) return null;
  return {
    surname: ranked[0].surname,
    hebrewFullName: `${first} ${ranked[0].surname}`,
    sources: ranked[0].sources,
    basis: "two_independent_pages",
  };
}

/** How a finding earned its place. Never collapsed into one boolean: "named in full" and
 *  "her given name beside her employer" are different strengths of proof, and a reader of
 *  the report has to be able to tell which one a run actually ran on. */
export type PersonNameMatch = "full_name" | "first_name_employer";

export type PersonGateInput = Pick<PersonResearchInput, "fullName" | "hebrewName"> & {
  companyName?: string | null;
  /** A surname learned from the run's own evidence (see learnHebrewSurname). */
  learnedHebrewSurname?: string | null;
};

/**
 * Does this result actually talk about the PERSON, or just about their employer — and on
 * what strength of proof?
 *
 * The 2026-09-01 prod probe is why this exists. `Contact.hebrewFullName` is nullable and
 * nobody has filled it, so the caller falls back to `hebrewFirstName` and the Hebrew
 * queries carry one given name. A lone given name cannot be quoted as a phrase without
 * matching every Pazit in Israel — but unquoted it lets the company name dominate instead,
 * and the provider happily returns the employer's own press. Pazit Garfinkel's six queries
 * came back with eight results of which none named her: a children's financial-literacy
 * launch, a comedian's campaign, and a book publisher.
 *
 * Handing those to the build is WORSE than handing it nothing: the prompt reads person
 * research as layer-4 FOUND evidence about the human and quotes it as such, so generic
 * employer news arrives wearing the person's name.
 *
 * The second half of the same probe is why this returns a TIER rather than a boolean. The
 * gate used to demand a full name, gave up on a single Hebrew token, and so accepted only
 * the English name — which a Hebrew-language article never contains. The system searched in
 * Hebrew and then threw away every Hebrew page it found: 71 fetched, 3 accepted, four THIN
 * profiles, and it read as "the web has nothing about her".
 *
 * So there are two ways in, and they are reported separately:
 *
 *   full_name             the English full name, the English surname, the Hebrew full name,
 *                         or the Hebrew surname once a full name established it.
 *   first_name_employer   the Hebrew GIVEN name as an exact token AND an identifying token
 *                         of the Hebrew employer name. Both halves, the same discipline the
 *                         query itself runs on — a lone given name pins nothing, so it is
 *                         never accepted alone. Weaker evidence, and it is the weaker one
 *                         that gets cut when there are more findings than the prompt holds.
 *
 * The residual risk of the weaker tier is named openly: "ארז יוסף פורש מבנק הפועלים" is a
 * DIFFERENT executive at the right employer, and it passes. Two things hold it down — the
 * tier label travels with the finding, and once the run has learned the real surname from
 * its own evidence, a page that puts a different family name after the given name is
 * rejected outright.
 *
 * Deterministic and free — no model decides this.
 */
export function matchPerson(text: string, input: PersonGateInput): PersonNameMatch | null {
  const hay = text.toLowerCase();
  const en = input.fullName.trim().toLowerCase();
  if (en && hay.includes(en)) return "full_name";
  // The surname alone: Israeli press writes "גרפינקל" and English coverage "Rachmil said",
  // without repeating the given name. Two characters is not a surname, it is a preposition.
  const enSurname = en.split(/\s+/).filter((w) => w.length > 2).at(-1);
  if (enSurname && hay.includes(enSurname)) return "full_name";

  const he = (input.hebrewName ?? "").trim();
  const heTokens = hebrewTokens(he);
  const first = heTokens[0] ?? "";
  if (first.length < 2) return null;
  // A recorded Hebrew surname is the strong case; a learned one is borrowed strength and
  // only exists because two independent pages agreed on it.
  const recorded = heTokens.length > 1 ? heTokens.filter((t) => t.length > 2).at(-1) : undefined;
  const surname = recorded ?? (input.learnedHebrewSurname ?? "").trim();

  if (recorded && he.length > 4 && text.includes(he)) return "full_name";
  if (surname && hasHebrewNamePair(text, first, surname)) return "full_name";
  // The Hebrew SURNAME on its own — identifying in a way a given name is not. Reached only
  // when a full name established it: from the record, or from two agreeing hosts.
  if (surname && surname.length > 2 && hasHebrewToken(text, surname)) return "full_name";

  // Below here is the weaker tier, and it is for records with NO Hebrew full name. When the
  // record does carry one and the page does not satisfy it, the page is about someone else.
  if (recorded) return null;
  if (!hasHebrewToken(text, first)) return null;
  const employer = employerTokens(input.companyName);
  if (!namesEmployer(text, employer)) return null;
  // A learned surname the page contradicts: same given name, different family name, so a
  // different person — the "other Erez at the same bank" false positive, caught.
  if (surname) {
    const cands = surnameCandidates(text, first, employer);
    if (cands.length > 0 && !cands.includes(surname)) return null;
  }
  return "first_name_employer";
}

/** Boolean form, kept for callers that only ask "is this about them at all". */
export function namesThePerson(text: string, input: PersonGateInput): boolean {
  return matchPerson(text, input) !== null;
}

export type PersonWebResearch = {
  findings: {
    title: string;
    url: string;
    snippet: string;
    pageText: string | null;
    /** Which proof let this one through. Full name, or given name plus employer. */
    match?: PersonNameMatch;
  }[];
  /** The queries actually run. On the report, so an empty result can name what was asked. */
  queries?: string[];
  /** How many WEB (serper /search) queries were spent — the primary source. */
  webQueries?: number;
  /** How many news-pool queries the last-resort top-up spent. */
  paidQueries?: number;
  /**
   * Unique results the gate looked at. `fetched` = accepted + rejected, always. The live
   * failure was a run that fetched 71 pages and accepted 3, and nothing in the return said
   * so — the gap was only visible to somebody reading the gate's source.
   */
  fetched?: number;
  /** Accepted because the page named the person in full. */
  acceptedFullName?: number;
  /** Accepted on the weaker proof: Hebrew given name plus the Hebrew employer. */
  acceptedFirstNameEmployer?: number;
  /** Results the gate threw out — they named the employer, or another person entirely. */
  rejected?: number;
  /**
   * The same number as `rejected`, under the name build-profiles.ts already reads for its
   * per-person report line. Kept so that report keeps working; `rejected` is the honest name.
   */
  discarded?: number;
  /**
   * A Hebrew family name this run learned from its own evidence, when the record had only a
   * given name. A SUGGESTION for a human to confirm before it is written to
   * `Contact.hebrewFullName` — that column is hand-filled by design and nothing here
   * persists anything. Absent unless two different hosts agreed.
   */
  suggestedHebrewSurname?: HebrewSurnameSuggestion;
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
/** Web results per query. Ten is what one prompt can carry across six queries. */
const WEB_MAX_PER_QUERY = 10;
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
    /**
     * WEB search — the primary, and the only source that has ever returned anything about
     * a person. See fetchSerperWeb's note: a news index does not carry an employer's
     * management page, a conference agenda, or a two-year-old interview, which is where a
     * person's remit actually lives.
     */
    webFetcher?: (query: string) => Promise<NewsResult[]>;
    /** Free Google News RSS. Demoted to a supplement — it answered nothing on its own. */
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
  const web =
    deps.webFetcher ??
    (inTest ? async () => [] : (query: string) => fetchSerperWeb(query, { max: WEB_MAX_PER_QUERY }));
  const rss =
    deps.rssFetcher ??
    (inTest ? async () => [] : (query: string) => fetchGoogleNewsRss(query, { max: RSS_MAX_PER_QUERY }));

  // WEB FIRST. Both of the earlier orderings — paid news pool, then free RSS — returned
  // zero findings that named the person, for every person, because both ask a news index a
  // question news indexes cannot answer.
  const collected: NewsResult[] = [];
  let webQueries = 0;
  for (const query of queries) {
    collected.push(...(await web(query)));
    webQueries += 1;
  }

  // RSS only tops up when web left us short of a person. Free, so it costs nothing to ask.
  if (namedIn(collected, input) < MIN_FINDINGS_BEFORE_PAID) {
    for (const query of queries) collected.push(...(await rss(query)));
  }

  // Paid top-up only when free came back thin.
  //
  // No company subscriptions: this pool is one person's, so nothing is shared across
  // companies the way a scan's pool is.
  // The news-pool top-up is the LAST resort now, and still decided on results that name
  // the person: eight results about a bank are not four about its executive.
  let paidQueries = 0;
  if (namedIn(collected, input) < MIN_FINDINGS_BEFORE_PAID && (deps.fetcher || !inTest)) {
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
  const textOf = (item: NewsResult) => `${item.title} ${item.snippet ?? ""}`;

  // LEARN THE SURNAME BEFORE GATING, when the record has only a given name. Titles and
  // snippets are the evidence available at this point: page reads are capped at four and
  // only happen for findings the gate already accepted, so learning from them would be
  // circular — it could only ever confirm what got in.
  const heTokens = hebrewTokens((input.hebrewName ?? "").trim());
  const suggestedHebrewSurname =
    heTokens.length === 1
      ? learnHebrewSurname(
          unique.map((item) => ({ url: item.url, text: textOf(item) })),
          { hebrewFirstName: heTokens[0], companyName: input.companyName }
        )
      : null;

  const gate: PersonGateInput = { ...input, learnedHebrewSurname: suggestedHebrewSurname?.surname ?? null };
  const classified = unique.map((item) => ({ item, match: matchPerson(textOf(item), gate) }));
  const full = classified.filter((c) => c.match === "full_name");
  const weak = classified.filter((c) => c.match === "first_name_employer");
  const rejected = classified.length - full.length - weak.length;
  // Strong proof first, so what falls off the end of MAX_FINDINGS is the weaker evidence
  // and the page reads are spent on the pages most likely to be about the right human.
  const named = [...full, ...weak];

  const findings: PersonWebResearch["findings"] = [];
  let reads = 0;
  for (const { item, match } of named.slice(0, MAX_FINDINGS)) {
    let pageText: string | null = null;
    if (reads < maxReads && (deps.readPage || !inTest)) {
      reads += 1;
      const page = await readPage(item.url);
      if (page?.text) pageText = page.text.slice(0, MAX_PAGE_TEXT_CHARS);
    }
    findings.push({
      title: item.title,
      url: item.url,
      snippet: item.snippet ?? "",
      pageText,
      match: match ?? undefined,
    });
  }

  // A loud zero, in the server log, at the moment it happens. The live run that motivated
  // all of this was indistinguishable from "the web has nothing about her" until somebody
  // read the gate's source: it had fetched 71 pages and thrown away 68 of them.
  if (unique.length > 0 && named.length === 0) {
    console.warn(
      `[radar] person-gate ALL REJECTED for ${input.fullName}: fetched=${unique.length} ` +
        `hebrewName=${(input.hebrewName ?? "").trim() || "-"} employerTokens=${employerTokens(input.companyName).join("/") || "-"}`
    );
  }
  if (suggestedHebrewSurname) {
    // Printed, never persisted. `Contact.hebrewFullName` stays hand-filled.
    console.log(
      `[radar] person-gate SUGGESTED hebrewFullName="${suggestedHebrewSurname.hebrewFullName}" ` +
        `for ${input.fullName} from ${suggestedHebrewSurname.sources.length} independent pages ` +
        `(${suggestedHebrewSurname.sources.join(" , ")}) — needs human confirmation`
    );
  }

  return {
    findings,
    queries,
    paidQueries,
    webQueries,
    fetched: unique.length,
    acceptedFullName: full.length,
    acceptedFirstNameEmployer: weak.length,
    rejected,
    discarded: rejected,
    ...(suggestedHebrewSurname ? { suggestedHebrewSurname } : {}),
  };
}

/** How many of these results actually name the person. The gate on every escalation. */
function namedIn(items: NewsResult[], input: PersonResearchInput): number {
  return dedupeByUrl(items).filter((i) => namesThePerson(`${i.title} ${i.snippet ?? ""}`, input)).length;
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
