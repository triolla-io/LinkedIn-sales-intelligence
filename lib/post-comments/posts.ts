// Pure helpers — no prisma import, safe to share with client code and the extension mindset.

export type ScrapedPost = {
  urn: string;
  text: string;
  postedAgoText: string | null;
};

export const MAX_POST_AGE_DAYS = 7;

const URN_RE = /urn:li:activity:(\d+)/;

export function normalizeUrn(raw: string): string | null {
  const m = URN_RE.exec(raw);
  return m ? `urn:li:activity:${m[1]}` : null;
}

export function postUrlFromUrn(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/**
 * The person's own posts and reposts — the "Posts" tab, NOT `/recent-activity/all/`.
 *
 * `all` is every kind of activity, including posts by other people that this person
 * merely liked or commented on. Those render as ordinary post cards carrying their own
 * activity urn, so scraping `all` would draft comments aimed at strangers' posts — the
 * opposite of "comment on the people I chose". `shares` is the tab that holds only what
 * they published or shared themselves.
 */
export function buildActivityUrl(linkedinUrl: string): string {
  return `${linkedinUrl.replace(/\/+$/, "")}/recent-activity/shares/`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// English suffixes LinkedIn uses: 5m 3h 2d 1w 1mo 2yr. Hebrew: דקות/שעות/ימים/שבוע/חודש/שנה
// plus the dual forms יומיים/שבועיים/חודשיים/שעתיים.
const HEBREW_DUALS: Array<[RegExp, number]> = [
  [/שעתיים/, 2 * HOUR],
  [/יומיים/, 2 * DAY],
  [/שבועיים/, 14 * DAY],
  [/חודשיים/, 60 * DAY],
];
const UNIT_MS: Array<[RegExp, number]> = [
  [/^mo|חודש/, 30 * DAY],
  [/^m(in)?$|דק/, MINUTE],
  [/^h|שע/, HOUR],
  [/^d|יום|ימים/, DAY],
  [/^w|שבוע/, 7 * DAY],
  [/^y|שנ/, 365 * DAY],
];

export function parsePostedAgo(text: string, now: Date): Date | null {
  const t = text.trim();
  if (!t) return null;
  for (const [re, ms] of HEBREW_DUALS) {
    if (re.test(t)) return new Date(now.getTime() - ms);
  }
  // "3d", "1mo • Edited", "לפני 3 ימים", "שבוע"
  const numMatch = /(\d+)\s*([a-z]+|[֐-׿]+)/i.exec(t);
  if (numMatch) {
    const n = Number(numMatch[1]);
    const unit = numMatch[2].toLowerCase();
    for (const [re, ms] of UNIT_MS) {
      if (re.test(unit)) return new Date(now.getTime() - n * ms);
    }
    return null;
  }
  // bare unit = 1 of it: "שבוע", "חודש", "לפני שעה"
  const bare = t.replace(/^לפני\s+/, "");
  for (const [re, ms] of UNIT_MS) {
    if (re.test(bare)) return new Date(now.getTime() - ms);
  }
  return null;
}

export function validateScrapedPosts(raw: unknown): ScrapedPost[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ScrapedPost[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { urn, text, postedAgoText } = item as Record<string, unknown>;
    if (typeof urn !== "string" || typeof text !== "string") continue;
    const normalized = normalizeUrn(urn);
    if (!normalized || seen.has(normalized)) continue;
    const trimmed = text.trim();
    if (!trimmed) continue;
    seen.add(normalized);
    out.push({
      urn: normalized,
      text: trimmed,
      postedAgoText: typeof postedAgoText === "string" ? postedAgoText : null,
    });
  }
  return out;
}
