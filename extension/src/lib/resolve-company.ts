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
