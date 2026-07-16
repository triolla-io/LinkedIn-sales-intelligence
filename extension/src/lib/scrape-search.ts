/**
 * People-search result scraping. The parsing is a pure, unit-tested function
 * (`parseCardFields`); `SCRAPE_FN_SOURCE` embeds it via `.toString()` and adds only the
 * DOM traversal (which relies on `innerText` and therefore runs in the real browser).
 *
 * Locale-agnostic: strips bidi/RTL control marks, splits the name on the "•" degree
 * separator, and recognizes Hebrew degree words + action labels. English input yields the
 * same output as the previous inline scraper.
 */

export type ParsedCardFields = {
  name: string;
  headline: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: string | null;
  cardAction: string | null;
};

export function parseCardFields(
  nameRaw: string,
  rawLines: string[],
): ParsedCardFields | null {
  const stripBidi = (s: string): string =>
    (s || "").replace(/[‎‏‪-‮⁦-⁩]/g, "");

  const norm = rawLines
    .map((s) => stripBidi(s).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = norm.filter((l, i) => i === 0 || l !== norm[i - 1]);

  // name: text before the "•" badge separator (locale-independent), minus star/"+N".
  const name = stripBidi(nameRaw)
    .split("•")[0]
    .replace(/\s*★.*/, "")
    .replace(/\+\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.length < 2) return null;
  const nameRawNorm = stripBidi(nameRaw).replace(/\s+/g, " ").trim();

  // degree: English tokens, then Hebrew ordinals after the "•" bullet.
  let degree: string | null = null;
  for (const l of lines) {
    const en = l.match(/\b(1st|2nd|3rd\+?)\b/);
    if (en) {
      degree = en[1].charAt(0) === "3" ? "3rd" : en[1];
      break;
    }
    const he = l.match(/•\s*(ראשון|שני|שלישי)/);
    if (he) {
      degree = he[1] === "ראשון" ? "1st" : he[1] === "שני" ? "2nd" : "3rd";
      break;
    }
  }

  // cardAction: English exact-line labels, then Hebrew equivalents.
  let cardAction: string | null = null;
  for (const l of lines) {
    const en = l.match(/^(connect|follow|following|pending|message)$/i);
    if (en) {
      cardAction = en[1].toLowerCase();
      break;
    }
    if (/^(התחבר|להתחבר|התחברות)$/.test(l)) { cardAction = "connect"; break; }
    if (/^עוקב$/.test(l)) { cardAction = "following"; break; }
    if (/^(עקוב|מעקב|לעקוב)$/.test(l)) { cardAction = "follow"; break; }
    if (/^(ממתין|בהמתנה)$/.test(l)) { cardAction = "pending"; break; }
    if (/הודעה/.test(l)) { cardAction = "message"; break; }
  }

  // content = everything that isn't the name line, chrome, or a degree badge. After the
  // bidi strip, a Hebrew degree badge line reads "• שלישי ומעלה" and matches the "^• " rule.
  const NOISE =
    /(^view .*profile$|^message$|^connect$|^follow$|^following$|^pending$|^save$|^more$|degree connection$|mutual connection|other mutual|\bfollowers?$|^status is |^• )/i;
  const content = lines.filter(
    (l) =>
      l !== name &&
      l !== nameRawNorm &&
      !NOISE.test(l) &&
      !/^(1st|2nd|3rd\+?)$/.test(l),
  );

  const headline = content[0] || null;
  let title: string | null = null;
  let company: string | null = null;
  if (headline) {
    const at = headline.match(/^(.*?)\s+at\s+(.+)$/);
    if (at) {
      title = at[1].trim();
      company = at[2].trim();
    } else {
      title = headline;
    }
  }

  let location: string | null = null;
  for (let i = 1; i < content.length; i++) {
    const l = content[i];
    if (/,/.test(l) || /israel|ישראל/i.test(l)) {
      location = l;
      break;
    }
  }

  return { name, headline, title, company, location, degree, cardAction };
}

export const SCRAPE_FN_SOURCE = `(() => {
  const parseCardFields = ${parseCardFields.toString()};
  const section = document.querySelector('main')
    || document.querySelector('section[aria-label="Primary content"]');
  if (!section) {
    const b = (document.body && document.body.innerText) || '';
    return { candidates: [], hasNextPage: false, debug: {
      title: document.title, href: location.href, vis: document.visibilityState,
      focus: document.hasFocus(), hasSection: false,
      inLinksDoc: document.querySelectorAll('a[href*="/in/"]').length,
      bodyLen: b.length, noResults: /no results found|לא נמצאו תוצאות/i.test(b),
      snippet: b.slice(0, 240),
    } };
  }
  const allLinks = Array.from(section.querySelectorAll('a[href*="/in/"]'));
  const seen = new Set();
  const out = [];
  for (const link of allLinks) {
    const profileUrl = link.href.split('?')[0];
    if (seen.has(profileUrl) || !profileUrl.match(/linkedin\\.com\\/in\\/[^\\/]+\\/?$/)) continue;
    seen.add(profileUrl);
    const slug = profileUrl.replace(/\\/$/, '').split('/in/')[1] || '';
    const urn = 'urn:li:member:' + slug;
    const card = link.closest('li') || link.parentElement?.parentElement?.parentElement || link.parentElement;
    const nameRaw = (link.innerText || '').split('\\n')[0];
    const rawLines = (card ? card.innerText : '').split('\\n');
    const fields = parseCardFields(nameRaw, rawLines);
    if (!fields) continue;
    out.push({ urn, profileUrl, ...fields });
  }
  const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Next' || b.innerText.trim() === 'הבא');
  const next = nextBtns[0];
  const hasNextPage = !!next && !next.disabled;
  const _b = (document.body && document.body.innerText) || '';
  return { candidates: out, hasNextPage, debug: {
    title: document.title, href: location.href, vis: document.visibilityState,
    focus: document.hasFocus(), hasSection: true, inLinksSection: allLinks.length,
    inLinksDoc: document.querySelectorAll('a[href*="/in/"]').length,
    bodyLen: _b.length, noResults: /no results found|לא נמצאו תוצאות/i.test(_b),
    snippet: _b.slice(0, 240),
  } };
})()`;
