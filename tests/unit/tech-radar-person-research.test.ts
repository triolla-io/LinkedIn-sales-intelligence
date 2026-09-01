import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The query cache reaches for prisma. Every test in this file must be a pure cache
 * miss with no DB anywhere near it — same stub the pool-news tests use.
 */
const getCachedQuery = vi.fn();
const putCachedQuery = vi.fn();
vi.mock("@/lib/news/query-cache", () => ({
  getCachedQuery: (...a: unknown[]) => getCachedQuery(...a),
  putCachedQuery: (...a: unknown[]) => putCachedQuery(...a),
  CACHE_TTL_HOURS: 24,
  EMPTY_CACHE_TTL_MINUTES: 90,
}));

const { buildPersonResearchQueries, researchPerson, learnHebrewSurname } = await import(
  "@/lib/tech-radar/person-research"
);

beforeEach(() => {
  getCachedQuery.mockReset();
  putCachedQuery.mockReset();
  getCachedQuery.mockResolvedValue(null);
  putCachedQuery.mockResolvedValue(undefined);
});

/** No-op pacing. fetchPoolNews sleeps QUERY_GAP_MS between pooled queries to keep GNews
 *  from 429-ing; four real queries would push a single test past vitest's 5s timeout,
 *  and there is nothing to be polite to when the fetcher is a spy. */
const noSleep = async () => {};

describe("buildPersonResearchQueries", () => {
  it("builds deterministic He+En queries around the person and employer", () => {
    const qs = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" });
    expect(qs).toContain('"Pazit Garfinkel" Bank Hapoalim interview');
    expect(qs.some((q) => q.includes("פזית גרפינקל"))).toBe(true);
    expect(qs.length).toBeLessThanOrEqual(6);
    expect(qs).toEqual(buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" })); // deterministic
  });
  it("omits Hebrew queries when no Hebrew name", () => {
    const qs = buildPersonResearchQueries({ fullName: "John Doe", companyName: "Acme" });
    expect(qs.every((q) => !/[א-ת]/.test(q))).toBe(true);
  });

  /**
   * The first two queries must not presuppose a press event. Every query used to be
   * interview/panel/keynote-shaped, which is a far narrower net than "what does this
   * person do" — and the whole of Pazit Garfinkel's public agenda sat outside it.
   */
  it("asks what the person OWNS before it asks about their press appearances", () => {
    const qs = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" });
    expect(qs[0]).toContain("תחומי אחריות");
    expect(qs.slice(0, 2).some((q) => /ראיון|כנס|interview|panel|keynote/.test(q))).toBe(false);
  });

  /**
   * `Contact` stores only `hebrewFirstName`, so the caller hands one token in. Quoted as a
   * phrase that was `"פזית" כנס` — every Pazit in Israel, pinned to nothing. A lone token
   * goes unquoted and always beside the company, which is what makes it a real constraint.
   */
  it("does not quote a lone Hebrew first name as a phrase", () => {
    const qs = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" });
    expect(qs.some((q) => q.includes('"פזית"'))).toBe(false);
    expect(qs.every((q) => !/[א-ת]/.test(q) || q.includes("בנק הפועלים"))).toBe(true);
    // A FULL Hebrew name is still quoted — it is specific enough to be a phrase.
    const full = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" });
    expect(full.some((q) => q.includes('"פזית גרפינקל"'))).toBe(true);
  });
});

describe("researchPerson — web first", () => {
  /**
   * The finding that ended a morning of wrong answers. Same serper key, same query
   * `פזית גרפינקל בנק הפועלים במה עוסקת`: /news returned nothing and /search returned the
   * Calcalist piece on her appointment, the bank's own management page and the CAL card
   * agreement. A person's remit is not this month's news, so a news index cannot hold it.
   */
  it("asks WEB search first and never escalates when it finds the person", async () => {
    const webFetcher = vi.fn(async (q: string) => [
      { title: `פזית גרפינקל — ${q}`, url: `https://calcalist.co.il/${encodeURIComponent(q)}`, snippet: "", source: "serper-web", publishedAt: null },
    ]);
    const rssFetcher = vi.fn();
    const fetcher = vi.fn();
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { webFetcher, rssFetcher, fetcher, readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(webFetcher).toHaveBeenCalledTimes(6);
    expect(res.webQueries).toBe(6);
    expect(rssFetcher).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(res.findings.length).toBeGreaterThanOrEqual(4);
  });

  /** Web found only employer pages: RSS is free, so it is asked before anything is paid. */
  it("falls back to free RSS before the paid news pool", async () => {
    const webFetcher = vi.fn(async () => [
      { title: "חברי הנהלה", url: "https://bankhapoalim.co.il/about", snippet: "", source: "serper-web", publishedAt: null },
    ]);
    const rssFetcher = vi.fn(async () => [
      { title: "ראיון עם פזית גרפינקל", url: "https://ynet.co.il/1", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    const fetcher = vi.fn(async () => []);
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { webFetcher, rssFetcher, fetcher, readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(rssFetcher).toHaveBeenCalled();
    expect(res.findings).toHaveLength(1);
    expect(res.discarded).toBe(1);
  });
});

describe("researchPerson — free first", () => {
  /**
   * The paid pool is a TOP-UP now, not the source. It was the only source until
   * 2026-09-01, and on 2026-08-31 three of the four paid providers were at exactly zero
   * for the month — so the one input that makes a person model personal returned nothing
   * for the four people v3 was built for.
   */
  it("runs on free RSS and never touches the paid pool when free is enough", async () => {
    const rssFetcher = vi.fn(async (q: string) => [
      { title: `פזית גרפינקל — ${q}`, url: `https://calcalist.co.il/${encodeURIComponent(q)}`, snippet: "s", source: "google-news-rss", publishedAt: null },
    ]);
    const fetcher = vi.fn();
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { rssFetcher, fetcher, readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(rssFetcher).toHaveBeenCalledTimes(6);
    expect(fetcher).not.toHaveBeenCalled();
    expect(res.paidQueries).toBe(0);
    expect(res.findings.length).toBeGreaterThanOrEqual(4);
  });

  it("tops up from the paid pool only when free came back thin", async () => {
    const rssFetcher = vi.fn(async () => []);
    const fetcher = vi.fn(async () => [
      { title: "ראיון עם פזית גרפינקל", url: "https://globes.co.il/a", snippet: "s", source: "serper", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { rssFetcher, fetcher, readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(fetcher).toHaveBeenCalled();
    expect(res.paidQueries).toBe(6);
    expect(res.findings.length).toBe(1);
  });

  /** The same interview is found by several queries and now by two providers on top. */
  it("dedupes the same story across queries and providers", async () => {
    const one = { title: "ראיון עם פזית גרפינקל", url: "https://calcalist.co.il/a/?utm_source=x", snippet: "s", source: "google-news-rss", publishedAt: null };
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      {
        rssFetcher: async () => [one, { ...one, url: "https://www.calcalist.co.il/a" }],
        fetcher: async () => [{ ...one, url: "http://calcalist.co.il/a/" }],
        readPage: async () => null, maxPageReads: 0, sleep: noSleep,
      }
    );
    expect(res.findings).toHaveLength(1);
  });
});

describe("researchPerson", () => {
  it("fetches queries, reads top pages, caps page reads", async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { title: "Interview with Pazit Garfinkel", url: "https://globes.co.il/a1", snippet: "s", source: "serper", publishedAt: null },
    ]);
    const readPage = vi.fn().mockResolvedValue({
      url: "https://globes.co.il/a1",
      title: "Interview with Pazit Garfinkel",
      text: "full interview text",
      finalUrl: "https://globes.co.il/a1",
    });
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { fetcher, readPage, maxPageReads: 1, sleep: noSleep }
    );
    expect(res.findings.length).toBeGreaterThan(0);
    expect(res.findings[0].pageText).toBe("full interview text");
    expect(readPage).toHaveBeenCalledTimes(1); // cap respected even with duplicate urls deduped
  });

  it("returns empty findings on total provider silence, never throws", async () => {
    const res = await researchPerson(
      { fullName: "X", companyName: "Y" },
      { fetcher: vi.fn().mockResolvedValue([]), readPage: vi.fn(), sleep: noSleep }
    );
    expect(res.findings).toEqual([]);
  });

  it("leaves pageText null past the cap rather than dropping the finding", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([{ title: "Garfinkel a", url: "https://globes.co.il/a", snippet: "sa", source: "serper", publishedAt: null }])
      .mockResolvedValue([{ title: "Garfinkel b", url: "https://calcalist.co.il/b", snippet: "sb", source: "serper", publishedAt: null }]);
    const readPage = vi.fn().mockResolvedValue({ url: "u", title: null, text: "read", finalUrl: "u" });
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", companyName: "Bank Hapoalim" },
      { fetcher, readPage, maxPageReads: 1, sleep: noSleep }
    );
    expect(res.findings).toHaveLength(2);
    expect(res.findings[0].pageText).toBe("read");
    expect(res.findings[1].pageText).toBeNull();
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  /**
   * The 2026-09-01 prod probe in one test. Six queries for Pazit Garfinkel returned eight
   * results and not one of them named her — a children's financial-literacy launch, a
   * comedian's campaign, a book publisher. Generic employer news handed to the build as
   * layer-4 evidence about the human is worse than no research at all, because the prompt
   * quotes it as if it were about her.
   */
  it("discards results that name only the employer, and says how many", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      { title: "מגיל 8: בנק הפועלים רוצה ללמד ילדים לנהל כסף", url: "https://maariv.co.il/1", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "אדיר מילר ובנק הפועלים ביחד", url: "https://ice.co.il/2", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "הוצאת ידיעות ספרים", url: "https://x.co.il/3", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "ראיון עם פזית גרפינקל על בנקאות דיגיטלית", url: "https://calcalist.co.il/4", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    // With only a given name on the record all four are still out, INCLUDING the genuine
    // one — and the reason is worth being exact about, because it is the discipline and not
    // a gap. Her Hebrew surname is not on the record, so the only remaining proof is the
    // given-name-plus-employer pairing, and that article's title names her employer nowhere.
    // One half of a two-half rule is not evidence. (The pairing firing when both halves ARE
    // present is the "gate — Hebrew first name plus the Hebrew employer" block below.)
    const givenNameOnly = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(givenNameOnly.findings).toHaveLength(0);
    expect(givenNameOnly.discarded).toBe(4);

    // With the full Hebrew name the same four results resolve correctly: the employer's
    // three stay out and hers comes through.
    const fullHebrew = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim בנק הפועלים" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(fullHebrew.findings).toHaveLength(1);
    expect(fullHebrew.findings[0].title).toContain("פזית גרפינקל");
    expect(fullHebrew.discarded).toBe(3);
  });

  /**
   * Both false positives the prod probe produced. A given name is not an identity: "גיל" is
   * also the Hebrew inside `גילאי`, and "ארז" belongs to every Erez — including the other
   * Erez at the same bank, whose resignation would have been read as this one's.
   */
  it("refuses a lone Hebrew given name as identification", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      { title: "INFINITY NADO מיני משגר חרב, גילאי 5+", url: "https://toys.co.il/1", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "ארז יוסף פורש מבנק הפועלים", url: "https://globes.co.il/2", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    const gil = await researchPerson(
      { fullName: "Gil Tamir", hebrewName: "גיל", companyName: "Phoenix" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(gil.findings).toHaveLength(0);
    expect(gil.discarded).toBe(2);

    const erez = await researchPerson(
      { fullName: "Erez Rachmil", hebrewName: "ארז", companyName: "Bank Hapoalim" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(erez.findings).toHaveLength(0);
  });

  it("survives an unreadable page — a null read is the normal case, not a failure", async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { title: "paywalled Rachmil piece", url: "https://themarker.com/x", snippet: "s", source: "serper", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "Erez Rachmil", companyName: "Y" },
      { fetcher, readPage: vi.fn().mockResolvedValue(null), sleep: noSleep }
    );
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].pageText).toBeNull();
  });
});

/**
 * PART 1 — the gate, when `Contact.hebrewFullName` is still empty.
 *
 * Measured on 2026-09-01: four Israeli banking executives were rebuilt live and came back
 * with 3, 0, 1 and 2 findings and THIN profiles, because the queries went out in Hebrew
 * (correct — the coverage is Hebrew) while the gate could only be satisfied by the English
 * name, which a Hebrew article never contains. 71 pages fetched, 3 accepted, and the number
 * that would have said so did not exist.
 */
describe("gate — Hebrew first name plus the Hebrew employer", () => {
  const pazit = { fullName: "Pazit Garfinkel", hebrewName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" };

  it("accepts a Hebrew page that carries the first name AND the Hebrew employer, labelled as the weaker proof", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      {
        title: "פזית גרפינקל מובילה את הבנקאות היוזמת בבנק הפועלים",
        url: "https://calcalist.co.il/1",
        snippet: "",
        source: "google-news-rss",
        publishedAt: null,
      },
    ]);
    const res = await researchPerson(pazit, {
      rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep,
    });
    expect(res.findings).toHaveLength(1);
    // Not merged with a full-name match: the caller has to be able to see which proof it was.
    expect(res.findings[0].match).toBe("first_name_employer");
    expect(res.acceptedFirstNameEmployer).toBe(1);
    expect(res.acceptedFullName).toBe(0);
    expect(res.rejected).toBe(0);
  });

  it("rejects some other פזית when nothing on the page ties her to the employer", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      { title: "פזית לוי פתחה מסעדה בתל אביב", url: "https://mako.co.il/9", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    const res = await researchPerson(pazit, {
      rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep,
    });
    expect(res.findings).toHaveLength(0);
    expect(res.rejected).toBe(1);
    expect(res.suggestedHebrewSurname).toBeUndefined();
  });

  /** Substring matching is the trap next door to the \b trap: "לאומי" sits inside
   *  "בינלאומי", and those are two different banks. */
  it("does not let בינלאומי satisfy a לאומי employer", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      { title: "פזית כהן מונתה בבנק הבינלאומי הראשון", url: "https://globes.co.il/7", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "Pazit Cohen", hebrewName: "פזית", companyName: "Bank Leumi בנק לאומי" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(res.findings).toHaveLength(0);
    expect(res.rejected).toBe(1);
  });

  /** A prefixed employer is ordinary Hebrew — "בלאומי" is "at Leumi" — and still not
   *  "בינלאומי", because only ONE prefix letter is allowed in front of the exact token. */
  it("accepts a one-letter Hebrew prefix on the employer token", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      { title: "פזית כהן מובילה את הדיגיטל בלאומי", url: "https://globes.co.il/8", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "Pazit Cohen", hebrewName: "פזית", companyName: "Bank Leumi בנק לאומי" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].match).toBe("first_name_employer");
  });

  /** The old false positives must stay out: exact tokens only, so "גיל" is not `גילאי`. */
  it("still refuses a given name that is only a substring of another word", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      { title: "INFINITY NADO מיני משגר חרב, גילאי 5+ בפניקס", url: "https://toys.co.il/1", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "Gil Tamir", hebrewName: "גיל", companyName: "Phoenix הפניקס" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(res.findings).toHaveLength(0);
  });
});

/**
 * PART 2 — the Hebrew surname is LEARNED from the pages, never transliterated.
 *
 * A model-invented Hebrew spelling aimed at a real named executive is a fabrication; two
 * independent pages that both put the same token straight after her given name are
 * evidence. Evidence may be SUGGESTED to a human. It may not be persisted here.
 */
describe("learning the Hebrew surname from evidence", () => {
  const pazit = { fullName: "Pazit Garfinkel", hebrewName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" };
  const item = (title: string, url: string) => ({ title, url, snippet: "", source: "google-news-rss", publishedAt: null });

  it("learns the surname from two different hosts and then accepts a page that never names the employer", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      item("פזית גרפינקל, מנהלת אגף, בבנק הפועלים", "https://calcalist.co.il/1"),
      item("ראיון: פזית גרפינקל על הבנקאות היוזמת בבנק הפועלים", "https://globes.co.il/2"),
      item("פזית גרפינקל בכנס הפינטק", "https://ynet.co.il/3"),
    ]);
    const res = await researchPerson(pazit, {
      rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep,
    });
    expect(res.suggestedHebrewSurname?.surname).toBe("גרפינקל");
    expect(res.suggestedHebrewSurname?.hebrewFullName).toBe("פזית גרפינקל");
    expect(res.suggestedHebrewSurname?.basis).toBe("two_independent_pages");
    expect(res.suggestedHebrewSurname?.sources.length).toBeGreaterThanOrEqual(2);
    // The third page names no employer at all and is accepted only because the surname is
    // now known — and it is accepted as a FULL-name match, which is what it is.
    expect(res.findings).toHaveLength(3);
    expect(res.acceptedFullName).toBe(3);
    expect(res.acceptedFirstNameEmployer).toBe(0);
    expect(res.rejected).toBe(0);
  });

  it("does not learn a surname from two pages on ONE host", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      item("פזית גרפינקל, מנהלת אגף, בבנק הפועלים", "https://calcalist.co.il/1"),
      item("פזית גרפינקל על הבנקאות היוזמת בבנק הפועלים", "https://calcalist.co.il/2"),
    ]);
    const res = await researchPerson(pazit, {
      rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep,
    });
    expect(res.suggestedHebrewSurname).toBeUndefined();
    // Both still come in on the weaker proof — the employer is named on both.
    expect(res.acceptedFirstNameEmployer).toBe(2);
    expect(res.acceptedFullName).toBe(0);
  });

  /** The dangerous false positive the module was already documenting: a DIFFERENT executive
   *  with the same given name at the right employer. Once the surname is known, she goes. */
  it("drops a different פזית at the same employer once the surname is known", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      item("פזית גרפינקל, מנהלת אגף, בבנק הפועלים", "https://calcalist.co.il/1"),
      item("ראיון: פזית גרפינקל על הבנקאות היוזמת בבנק הפועלים", "https://globes.co.il/2"),
      item("פזית כהן מונתה לסמנכלית בבנק הפועלים", "https://mako.co.il/3"),
    ]);
    const res = await researchPerson(pazit, {
      rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep,
    });
    expect(res.suggestedHebrewSurname?.surname).toBe("גרפינקל");
    expect(res.findings.map((f) => f.url)).not.toContain("https://mako.co.il/3");
    expect(res.acceptedFullName).toBe(2);
    expect(res.rejected).toBe(1);
  });

  it("never takes a job title, or a word across punctuation, as a surname", () => {
    expect(
      learnHebrewSurname(
        [
          { url: "https://a.co.il/1", text: "פזית, מנהלת אגף בבנק הפועלים" },
          { url: "https://b.co.il/1", text: "פזית מנהלת את אגף הבנקאות" },
        ],
        { hebrewFirstName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" }
      )
    ).toBeNull();
  });

  it("refuses to choose between two surnames that are equally attested", () => {
    expect(
      learnHebrewSurname(
        [
          { url: "https://a.co.il/1", text: "פזית גרפינקל בבנק הפועלים" },
          { url: "https://b.co.il/1", text: "פזית גרפינקל בבנק הפועלים" },
          { url: "https://c.co.il/1", text: "פזית לוי בבנק הפועלים" },
          { url: "https://d.co.il/1", text: "פזית לוי בבנק הפועלים" },
        ],
        { hebrewFirstName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" }
      )
    ).toBeNull();
  });

  it("never suggests a surname when the Hebrew FULL name is already on the record", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      item("פזית גרפינקל, מנהלת אגף, בבנק הפועלים", "https://calcalist.co.il/1"),
      item("ראיון: פזית גרפינקל בבנק הפועלים", "https://globes.co.il/2"),
    ]);
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim בנק הפועלים" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(res.suggestedHebrewSurname).toBeUndefined();
    expect(res.acceptedFullName).toBe(2);
  });
});

/** PART 3 — the numbers that would have made the live failure readable. */
describe("researchPerson — gate counters", () => {
  it("reports how many were fetched, how each accepted one was proved, and how many the gate rejected", async () => {
    const rssFetcher = vi.fn().mockResolvedValue([
      { title: "מגיל 8: בנק הפועלים רוצה ללמד ילדים לנהל כסף", url: "https://maariv.co.il/1", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "אדיר מילר ובנק הפועלים ביחד", url: "https://ice.co.il/2", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "הוצאת ידיעות ספרים", url: "https://x.co.il/3", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "תחזית מאקרו לרבעון", url: "https://y.co.il/4", snippet: "", source: "google-news-rss", publishedAt: null },
      { title: "פזית גרפינקל על הבנקאות היוזמת בבנק הפועלים", url: "https://calcalist.co.il/5", snippet: "", source: "google-news-rss", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" },
      { rssFetcher, fetcher: vi.fn().mockResolvedValue([]), readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(res.fetched).toBe(5);
    expect(res.acceptedFullName).toBe(0);
    expect(res.acceptedFirstNameEmployer).toBe(1);
    expect(res.rejected).toBe(4);
    // `discarded` is the same number under the name build-profiles.ts already reads.
    expect(res.discarded).toBe(4);
    expect((res.acceptedFullName ?? 0) + (res.acceptedFirstNameEmployer ?? 0) + (res.rejected ?? 0)).toBe(res.fetched);
  });
});
