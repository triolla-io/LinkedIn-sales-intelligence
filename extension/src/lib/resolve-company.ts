/**
 * RESOLVE_COMPANY page-context IIFEs. Kept as strings so they can be evaluated via
 * CDP Runtime.evaluate (returnByValue) — same mechanism as SCRAPE_FN_SOURCE — and
 * unit-tested by eval() in jsdom.
 */

/** Runs on a company page. Extracts the numeric company id + canonical name. */
export const EXTRACT_COMPANY_FN_SOURCE = `(() => {
  const html = document.documentElement.innerHTML;
  const patterns = [
    /urn:li:fsd_company:(\\d+)/,
    /"voyagerCompanyId"\\s*:\\s*(\\d+)/,
    /voyagerCompanyId=(\\d+)/,
    /"companyId"\\s*:\\s*(\\d+)/,
  ];
  let companyId = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m) { companyId = m[1]; break; }
  }
  const h1 = document.querySelector('h1');
  const og = document.querySelector('meta[property="og:title"]');
  const resolvedName =
    (h1 && h1.textContent && h1.textContent.trim()) ||
    (og && og.getAttribute('content')) ||
    null;
  return { companyId, resolvedName, url: location.href.split('?')[0] };
})()`;

/** Runs on the companies search results page. Picks the top /company/ result. */
export const TOP_COMPANY_RESULT_FN_SOURCE = `(() => {
  const links = Array.from(document.querySelectorAll('a[href*="/company/"]'));
  const link = links.find((a) => /linkedin\\.com\\/company\\/[^/?#]+\\/?$/.test(a.href.split('?')[0]));
  if (!link) return null;
  const card = link.closest('li') || link.parentElement;
  const text = (card ? card.textContent : link.textContent) || '';
  const name = text.split('\\n').map((s) => s.trim()).filter(Boolean)[0] || null;
  return { companyUrl: link.href.split('?')[0], name };
})()`;

export function companySlugFromUrl(url: string): string | null {
  const m = url.split("?")[0].match(/linkedin\.com\/company\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

export function companySearchUrl(name: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(name)}`;
}

/** Tokens dropped before scoring: geo qualifiers + generic corporate suffixes. */
const STOP_TOKENS = new Set([
  "il",
  "israel",
  "ישראל",
  "group",
  "ltd",
  "holdings",
  "inc",
  "corp",
  "co",
]);

/** Lowercase, strip punctuation, split to tokens, and drop stop-tokens. */
export function normalizeCompanyName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,'"()|/\\־-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOP_TOKENS.has(t));
}

/** Fraction of the requested name's significant tokens that the candidate covers (0..1). */
export function scoreCompanyMatch(requested: string, candidate: string): number {
  const reqTokens = normalizeCompanyName(requested);
  if (reqTokens.length === 0) return 0;
  const candSet = new Set(normalizeCompanyName(candidate));
  const covered = reqTokens.filter((t) => candSet.has(t)).length;
  return covered / reqTokens.length;
}

export const MATCH_THRESHOLD = 0.5;

/**
 * Best name match among candidates (LinkedIn result order). Ties resolve to the earlier
 * (higher-ranked) candidate. Returns null when the best score is below `threshold` or the
 * list is empty. When the requested name has no significant tokens (only geo/suffix words),
 * falls back to the top-ranked candidate rather than over-failing.
 */
export function pickBestCompany(
  requested: string,
  candidates: Array<{ companyUrl: string; name: string | null }>,
  threshold: number = MATCH_THRESHOLD,
): { companyUrl: string; name: string | null } | null {
  if (candidates.length === 0) return null;
  if (normalizeCompanyName(requested).length === 0) return candidates[0];
  let best: { companyUrl: string; name: string | null } | null = null;
  let bestScore = -1;
  for (const cand of candidates) {
    const score = scoreCompanyMatch(requested, cand.name ?? "");
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return bestScore >= threshold ? best : null;
}
