/**
 * Which market a query is asking about, derived from the language it is written in.
 *
 * The 2026-08-26 person-radar run found 200 items and ZERO Israeli sources for four
 * Israeli banking and insurance executives — the items that reached the veto were about
 * Greece and India. The measurement for this already existed (`isIsraeliSource` in
 * lib/tech-radar/acceptance.ts) and had been reporting the shortfall; what was missing is
 * that no provider ever ASKED for Israeli results.
 *
 * Per-query, never blanket. An axis whose queries are written in Hebrew is asking about
 * the Israeli market; an axis whose queries are in English is asking about the global
 * one, and forcing Israel onto those would break the global axes that work.
 *
 * Pure.
 */

/** Every provider's spelling of the same intent, resolved once. */
export type QueryLocale = {
  /** Google-family country (serpapi, serper). */
  gl: string;
  /** Google-family UI language (serpapi, serper). */
  hl: string;
  /** GNews language. */
  lang: string;
  /** GNews country. */
  country: string;
  /** Serper takes a human-readable place rather than a code. */
  location: string;
  /** GDELT's own sourcelang: query operator spelling (three-letter). */
  gdeltSourceLang: string;
  /** GDELT's own sourcecountry: query operator spelling (FIPS two-letter). */
  gdeltSourceCountry: string;
  /** Google News RSS `hl` param. */
  rssHl: string;
  /** Google News RSS `gl` param. */
  rssGl: string;
  /** Google News RSS `ceid` param — the two above, joined, in ITS spelling. */
  rssCeid: string;
};

export const ISRAEL_LOCALE: QueryLocale = {
  gl: "il",
  hl: "he",
  lang: "he",
  country: "il",
  location: "Israel",
  gdeltSourceLang: "heb",
  gdeltSourceCountry: "IS",
  rssHl: "he",
  rssGl: "IL",
  rssCeid: "IL:he",
};

/**
 * Hebrew LETTERS only (U+05D0-U+05EA), deliberately narrower than the Hebrew block.
 * The block also holds niqqud and punctuation — the maqaf U+05BE turns up inside
 * English text as a stylistic hyphen ("real־time"), and treating that as a Hebrew
 * query would send an English global query to the Israeli locale.
 */
const HEBREW_LETTER = /[א-ת]/;

/**
 * The locale to ask for, or null to leave the provider on its default — which is what
 * every existing English query should keep doing.
 */
export function localeForQuery(query: string): QueryLocale | null {
  return HEBREW_LETTER.test(query) ? ISRAEL_LOCALE : null;
}
