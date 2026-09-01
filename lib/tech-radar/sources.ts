/**
 * Source packs: WHAT the radar reads, as data.
 *
 * The v3 inversion. Until now a person's axes wrote free-text queries and fired them at
 * six news providers; on 2026-08-31 that mechanism hit its ceiling in the most literal
 * way possible — serper 0/1500 remaining, serpapi 0/1500, tavily 0/950 — and Bank
 * Hapoalim's employer research therefore ran on FIVE news items, which is why its
 * layer-3 "recent moves" were dated 2024. The system could not see what the bank was
 * doing that month. A fixed list of publishers pulled by RSS costs nothing and has no
 * quota to exhaust, so recall stops being a budget question.
 *
 * Exactly 10 global + 10 Israeli per industry. Both halves are re-picked per industry
 * (overlap between industries is fine) — an Israeli banker and an Israeli retailer do
 * not read the same ten Israeli outlets, and the previous design's single shared net is
 * what let "a retail bank in the Philippines launched a feature" reach a Bank Hapoalim
 * executive.
 *
 * PURE DATA. No imports, no prisma, no fetch — the pack-editing screen is a client
 * component and importing anything prisma-shaped here would break `next build`
 * (the known client/prisma trap). Fetching lives in fetch-sources.ts.
 *
 * This module holds the SEED. The live pack is a RadarSourcePack row, edited by a human
 * in the UI; the seed only decides what a brand-new org starts with.
 */

export type SourceLang = "he" | "en";
export type SourceScope = "global" | "il";

export type PackSource = {
  /** Bare registrable host, no scheme and no www — the dedupe key, the gift gate's key
   *  (source-quality.ts) and the UI's identity for the row are all the host. */
  host: string;
  /** Human-facing outlet name; shown in the editing screen and the run report. */
  name: string;
  /**
   * Direct feed URL, when we know it for certain.
   *
   * Left UNSET on purpose for every outlet whose feed path we would be guessing. A wrong
   * feed URL is a silent recall loss — the source reports an error and contributes
   * nothing, which reads like a quiet week — whereas an unset `rss` routes the outlet
   * through the site-restricted Google News feed, which works on any domain (see
   * lib/news/google-news-rss.ts). Filling one in is a UI edit, not a deploy.
   */
  rss?: string;
  lang: SourceLang;
  scope: SourceScope;
  /**
   * The Google-News query for the fallback path, when `site:<host>` alone is too broad.
   * Forbes and S&P Global have no fintech-section feed, and pulling the entire outlet
   * would spend triage tokens (~$0.35 per 200-item pool) on sport and lifestyle.
   */
  newsQuery?: string;
  /** A human's off switch. Kept in the pack rather than deleted, so turning an outlet
   *  back on is one click and the history of the choice survives. */
  enabled: boolean;
};

/** One entry of the CLOSED classification vocabulary. `tag` is the stable key the triage
 *  model must echo verbatim; `label` is what a human reads. */
export type TaxonomyTag = { tag: string; label: string };

export type SourcePack = {
  /** Normalised industry key — the same `industry.canonical` that creates the INDUSTRY
   *  axis, so the Hebrew and English spellings of one industry key one pack. */
  industryKey: string;
  /**
   * Hebrew, human-facing. OPTIONAL because a pack reconstructed from a RadarSourcePack
   * row carries only industryKey — there is no `label` column, and the migration stays
   * additive-minimal. A caller with no label should show industryKey, which is already
   * written in Hebrew.
   */
  label?: string;
  sources: PackSource[];
  taxonomy: TaxonomyTag[];
  /**
   * Names whose moves TRAVEL into any market in this industry — the "שחקן גלובלי" road
   * out of the geography gate (`travels()` in match-floors.ts).
   *
   * On the PACK and not on the person, and not hard-coded in the floors either: who
   * counts as a global player is an industry fact (JPMorgan for a banker, Zara for a
   * retailer), the floors have no industry, and a person-level list would have to be
   * re-derived by every profile build. The floors read it through
   * `FloorPerson.globalPlayers`, which the scan fills from the person's own pack.
   *
   * Optional, and an absent list is not a failure: with none, only the country-agnostic
   * markers in match-floors.ts (global scope words, BIS/IMF/OECD, the report houses) let
   * a foreign story through, which is the conservative direction.
   */
  globalPlayers?: string[];
};

/**
 * The opening pack — Israeli banking and financial services. Ariel's global ten, and the
 * Israeli ten proposed in the design doc and editable in the screen.
 *
 * Ten global outlets first, then ten Israeli ones.
 */
export const BANKING_IL_PACK: SourcePack = {
  industryKey: "בנקאות ופיננסים ישראל",
  label: "בנקאות ופיננסים — ישראל",
  sources: [
    // ---- Global (10) -------------------------------------------------------
    // Finextra publishes a stable headline feed; the only global source whose exact feed
    // path is documented rather than inferred.
    { host: "finextra.com", name: "Finextra", rss: "https://www.finextra.com/rss/headlines.aspx", lang: "en", scope: "global", enabled: true },
    { host: "fintechfutures.com", name: "FinTech Futures", rss: "https://www.fintechfutures.com/feed/", lang: "en", scope: "global", enabled: true },
    { host: "thefintechtimes.com", name: "The Fintech Times", rss: "https://thefintechtimes.com/feed/", lang: "en", scope: "global", enabled: true },
    { host: "finovate.com", name: "Finovate", rss: "https://finovate.com/feed/", lang: "en", scope: "global", enabled: true },
    { host: "fintechnexus.com", name: "Fintech Nexus", rss: "https://www.fintechnexus.com/feed/", lang: "en", scope: "global", enabled: true },
    { host: "crowdfundinsider.com", name: "Crowdfund Insider", rss: "https://www.crowdfundinsider.com/feed/", lang: "en", scope: "global", enabled: true },
    // The fintech CATEGORY feed, not the firehose — TechCrunch's front page would flood
    // the 200-item pool cap on its own.
    { host: "techcrunch.com", name: "TechCrunch — Fintech", rss: "https://techcrunch.com/category/fintech/feed/", lang: "en", scope: "global", enabled: true },
    { host: "forbes.com", name: "Forbes — Fintech", lang: "en", scope: "global", newsQuery: "site:forbes.com fintech", enabled: true },
    { host: "bloomberg.com", name: "Bloomberg Technology", rss: "https://feeds.bloomberg.com/technology/news.rss", lang: "en", scope: "global", enabled: true },
    { host: "spglobal.com", name: "S&P Global Market Intelligence", lang: "en", scope: "global", newsQuery: "site:spglobal.com banking", enabled: true },

    // ---- Israeli (10) ------------------------------------------------------
    // Almost all of these route through the site-restricted Google News feed on purpose:
    // the Israeli outlets' own feed paths are CMS-specific ids we would be guessing at,
    // and the fallback carries the IL:he locale — which is the actual fix for the
    // 2026-08-26 run that found 200 items and zero Israeli sources.
    { host: "globes.co.il", name: "גלובס", lang: "he", scope: "il", enabled: true },
    { host: "calcalist.co.il", name: "כלכליסט", lang: "he", scope: "il", enabled: true },
    { host: "themarker.com", name: "דה-מרקר", lang: "he", scope: "il", enabled: true },
    { host: "bizportal.co.il", name: "ביזפורטל", lang: "he", scope: "il", enabled: true },
    { host: "ynet.co.il", name: "וואינט כלכלה", lang: "he", scope: "il", newsQuery: "site:ynet.co.il כלכלה", enabled: true },
    { host: "mako.co.il", name: "מאקו כסף", lang: "he", scope: "il", newsQuery: "site:mako.co.il כסף", enabled: true },
    { host: "geektime.co.il", name: "גיקטיים", rss: "https://www.geektime.co.il/feed/", lang: "he", scope: "il", enabled: true },
    { host: "funder.co.il", name: "פאנדר", lang: "he", scope: "il", enabled: true },
    { host: "ice.co.il", name: "ice", lang: "he", scope: "il", enabled: true },
    { host: "haaretz.co.il", name: "הארץ — כלכלה", lang: "he", scope: "il", newsQuery: "site:haaretz.co.il כלכלה", enabled: true },
  ],
  /**
   * The closed vocabulary — 50 tags. Closedness is the whole mechanism: the 2026-08
   * experience with fit.ts is that free-text overlap fails SILENTLY on synonyms (two
   * spellings of one idea score zero and nobody sees a bug). Triage may only echo a
   * `tag` from this list; anything else is dropped, never coerced.
   *
   * Written as classification language ("האשראי הצרכני של משקי הבית"), not as search
   * queries — nothing here is ever sent to a search provider.
   */
  taxonomy: [
    { tag: "אשראי-צרכני", label: "אשראי צרכני ומשקי בית" },
    { tag: "משכנתאות", label: "משכנתאות ודיור" },
    { tag: "פיקדונות-וחיסכון", label: "פיקדונות, חיסכון וריבית" },
    { tag: "תשלומים", label: "תשלומים" },
    { tag: "תשלומים-מיידיים", label: "תשלומים מיידיים והעברות בזמן אמת" },
    { tag: "כרטיסי-אשראי", label: "כרטיסי אשראי וחברות הכרטיסים" },
    { tag: "ארנקים-דיגיטליים", label: "ארנקים דיגיטליים ותשלום במובייל" },
    { tag: "סליקה-וסוחרים", label: "סליקה, בתי עסק וסוחרים" },
    { tag: "העברות-בינלאומיות", label: "העברות כספים בינלאומיות ומטבע חוץ" },
    { tag: "בנקאות-פתוחה", label: "בנקאות פתוחה וממשקי API" },
    { tag: "ניוד-חשבונות", label: "ניוד חשבונות ומעבר בין בנקים" },
    { tag: "בנקאות-דיגיטלית", label: "בנקאות דיגיטלית" },
    { tag: "אפליקציה-ומובייל", label: "אפליקציה וחוויית מובייל" },
    { tag: "סניפים-וערוצים", label: "סניפים, מוקדים וערוצי שירות" },
    { tag: "חוויית-לקוח", label: "חוויית לקוח ונאמנות" },
    { tag: "KYC-ואימות", label: "KYC, זיהוי לקוח ואימות" },
    { tag: "הונאות-ומניעתן", label: "הונאות ומניעת הונאות" },
    { tag: "סייבר-ואבטחת-מידע", label: "סייבר ואבטחת מידע" },
    { tag: "פרטיות-ומידע", label: "פרטיות והגנה על מידע" },
    { tag: "רגולציה-ישראל", label: "רגולציה בישראל" },
    { tag: "בנק-ישראל", label: "בנק ישראל והפיקוח על הבנקים" },
    { tag: "רשות-ניירות-ערך", label: "רשות ניירות ערך ורשות שוק ההון" },
    { tag: "רגולציה-גלובלית", label: "רגולציה גלובלית ותקינה בינלאומית" },
    { tag: "הלימות-הון", label: "הלימות הון, באזל ומבחני קיצון" },
    { tag: "איסור-הלבנת-הון", label: "איסור הלבנת הון וציות" },
    { tag: "בנקאות-עסקית", label: "בנקאות עסקית" },
    { tag: "אשראי-לעסקים-קטנים", label: "אשראי לעסקים קטנים ובינוניים" },
    { tag: "בנקאות-תאגידית", label: "בנקאות תאגידית ומימון גדול" },
    { tag: "שוקי-הון", label: "שוקי הון ומסחר" },
    { tag: "חיתום-והנפקות", label: "חיתום, הנפקות ובנקאות להשקעות" },
    { tag: "ניהול-נכסים", label: "ניהול נכסים וייעוץ השקעות" },
    { tag: "פנסיה-וגמל", label: "פנסיה, גמל וחיסכון ארוך טווח" },
    { tag: "ביטוח-ופינטק-ביטוחי", label: "ביטוח ופינטק ביטוחי" },
    { tag: "אשראי-חוץ-בנקאי", label: "אשראי חוץ בנקאי ומימון אלטרנטיבי" },
    { tag: "בנקים-מאתגרים", label: "בנקים מאתגרים ונאובנקים" },
    { tag: "תחרות-בשוק", label: "תחרות בשוק הבנקאות" },
    { tag: "מיזוגים-ורכישות", label: "מיזוגים ורכישות" },
    { tag: "השקעות-בפינטק", label: "השקעות והשקעות סיכון בפינטק" },
    { tag: "גיוסי-הון", label: "גיוסי הון של חברות פינטק" },
    { tag: "בנקאות-כשירות", label: "בנקאות כשירות ושיתופי פעולה עם פינטק" },
    { tag: "ליבה-בנקאית", label: "מערכות ליבה בנקאיות והמרתן" },
    { tag: "ענן-ותשתיות", label: "ענן ותשתיות טכנולוגיות" },
    { tag: "בינה-מלאכותית", label: "בינה מלאכותית ומודלים" },
    { tag: "אוטומציה-ותהליכים", label: "אוטומציה וייעול תהליכים" },
    { tag: "דאטה-ואנליטיקה", label: "דאטה, אנליטיקה ודירוג אשראי" },
    { tag: "בלוקצ'יין-וקריפטו", label: "בלוקצ'יין, קריפטו ונכסים דיגיטליים" },
    { tag: "מטבע-דיגיטלי-מרכזי", label: "שקל דיגיטלי ומטבעות בנק מרכזי" },
    { tag: "מימון-בר-קיימא", label: "ESG ומימון בר-קיימא" },
    { tag: "תוצאות-כספיות", label: "תוצאות כספיות ודוחות" },
    { tag: "מינויים-ואנשים", label: "מינויים, אנשים ושינויים ארגוניים" },
  ],
  /**
   * The banking/fintech names an Israeli banker reads about whatever country the story
   * happens in. Both scripts, because the Israeli press writes "ג'יי פי מורגן" and the
   * wires write "JPMorgan", and a list in one script only is a recall hole with no symptom.
   *
   * Kept SHORT and to genuine reference points on purpose: every name added here is a
   * hole in the geography gate — the gate that stops "a retail bank in the Philippines
   * launched a feature" from reaching a Bank Hapoalim executive. A rival's local move in
   * Manila must not travel just because a global brand is mentioned in passing, so the
   * bar for membership is "an Israeli banker would read this whatever the market", not
   * "a big company".
   */
  globalPlayers: [
    "JPMorgan", "ג'יי פי מורגן",
    "Goldman Sachs", "גולדמן זאקס",
    "HSBC",
    "Citi", "Citigroup", "סיטי",
    "Visa", "ויזה",
    "Mastercard", "מאסטרקארד",
    "PayPal", "פייפאל",
    "Stripe", "סטרייפ",
    "Revolut", "רבולוט",
    "SWIFT",
  ],
};
