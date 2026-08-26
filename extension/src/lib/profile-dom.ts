/**
 * Page-context profile-topcard reader (runs inside the content script).
 *
 * Split out from scrape-profile.ts so the content script never imports the background-side
 * tab driver: this file is DOM-only, and its output feeds the pure `parseProfileRole`.
 */

export interface RawEntry {
  title: string | null;
  company: string | null;
  current: boolean;
  startDate: string | null;
}

export interface ExperienceItem {
  title: string;
  company: string | null;
  dateRange: string | null;
}

const clean = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();

const ABOUT_HEADERS = ["about", "אודות"];
const EXPERIENCE_HEADERS = ["experience", "ניסיון"];

/**
 * Find the <section> whose <h2> text (lowercased/trimmed) is one of `headers`. Same
 * access pattern as readProfileTopcard below — plain document.querySelectorAll("section"),
 * no shadow-root piercing: the profile app is NOT in a shadow root (that warning belongs to
 * the CONNECT invite modal, a different part of the page). LinkedIn ships an English/Hebrew
 * <h2> per section depending on the viewer's UI language, so we match both.
 */
function findSection(headers: string[]): HTMLElement | null {
  for (const section of Array.from(document.querySelectorAll("section"))) {
    const h2 = section.querySelector("h2");
    if (h2 && headers.includes(clean(h2.textContent).toLowerCase())) {
      return section as HTMLElement;
    }
  }
  return null;
}

/**
 * About section: LinkedIn renders the bio as one or more <p> blocks (occasionally split
 * across a "…see more" truncation). We want the actual bio, not a stray short line, so we
 * take the longest paragraph. Some renders skip <p> entirely and put the bio straight in a
 * <div> — fall back to the section's own text (minus its <h2>) in that case.
 *
 * Capped at 2000 chars: the server (Task 2's handleScrapeProfile) applies the same cap
 * before storing, so this just avoids shipping a huge payload over the page-message bridge.
 */
export function readProfileAbout(): string | null {
  const section = findSection(ABOUT_HEADERS);
  if (!section) return null;
  const paragraphs = Array.from(section.querySelectorAll("p"))
    .map((p) => clean(p.textContent))
    .filter(Boolean);
  let text = paragraphs.length ? paragraphs.reduce((a, b) => (b.length > a.length ? b : a)) : "";
  if (!text) {
    const h2Text = clean(section.querySelector("h2")?.textContent);
    text = clean(section.textContent).replace(h2Text, "").trim();
  }
  return text ? text.slice(0, 2000) : null;
}

/**
 * Leaf-level text within one experience <li>, in DOM order, deduped: LinkedIn commonly
 * doubles a line's text (one visible span + one visually-hidden a11y span with the same
 * content), and reading only leaves — elements with no element children — skips the
 * wrapping containers that would otherwise repeat that text.
 */
function leafLines(root: Element): { text: string; bold: boolean }[] {
  const lines: { text: string; bold: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (el: Element) => {
    const children = Array.from(el.children);
    if (children.length) {
      for (const child of children) walk(child);
      return;
    }
    const text = clean(el.textContent);
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push({ text, bold: !!el.closest("h3, strong, b") });
  };
  walk(root);
  return lines;
}

// "Acme Inc · Full-time" → "Acme Inc" — the employment-type suffix LinkedIn appends after
// the company name, in whichever language the viewer's UI is in.
const EMPLOYMENT_SUFFIX =
  /\s*[·•]\s*(Full-time|Part-time|Contract|Internship|Freelance|Self[- ]employed|Seasonal|Temporary|משרה מלאה|משרה חלקית|חוזה|פרילנס)\b.*$/i;

/**
 * Experience section: each role is one <li>. Within it, the title is the first bold/heading
 * line (LinkedIn always bolds the role title, not the company), the company is the next
 * distinct line with the employment-type suffix stripped, and the date range is whichever
 * line contains a 4-digit year (it isn't always in a fixed position — some entries insert a
 * location line before it). Entries with no title (LinkedIn can render an empty placeholder
 * <li> while a section is still hydrating) are skipped. Capped to 5: matches the cap
 * Task 2's handleScrapeProfile applies before storing.
 */
export function readProfileExperience(): ExperienceItem[] {
  const section = findSection(EXPERIENCE_HEADERS);
  if (!section) return [];
  const results: ExperienceItem[] = [];
  for (const li of Array.from(section.querySelectorAll("li"))) {
    // Skip nested <li>s belonging to a grouped multi-role-at-one-company entry — they were
    // already walked as part of their parent li's leafLines().
    if (li.parentElement?.closest("li")) continue;
    const lines = leafLines(li);
    if (!lines.length) continue;
    const titleIdx = lines.findIndex((l) => l.bold);
    const title = (titleIdx >= 0 ? lines[titleIdx] : lines[0])?.text;
    if (!title) continue;
    const rest = lines.filter((_, i) => i !== (titleIdx >= 0 ? titleIdx : 0));
    const rawCompany = rest[0]?.text ?? null;
    const company = rawCompany ? rawCompany.replace(EMPLOYMENT_SUFFIX, "").trim() || null : null;
    const dateLine = lines.find((l) => /\d{4}/.test(l.text)) ?? null;
    results.push({ title, company, dateRange: dateLine?.text ?? null });
    if (results.length >= 5) break;
  }
  return results;
}

/**
 * Reads the CURRENT role from the profile TOP CARD, which is LinkedIn's own "primary current role" display —
 * so we avoid the fragile Experience-section parsing AND the multiple-"current"-entries
 * problem entirely.
 *
 * LinkedIn's profile is now SDUI (server-driven UI): class names are obfuscated hashes that
 * change frequently, so we anchor on the STABLE bits instead of classes:
 *   - name    → <title> ("Name | LinkedIn")
 *   - company → the topcard company block, anchored on the <svg id="company-accent-*"> icon
 *   - title   → the first meaningful <p> in the topcard <section> (the headline), skipping
 *               the name, connection-degree "· 1st/2nd" markers, connection counts, and
 *               "Contact info".
 * Verified against a live profile (Paz Romano) on 2026-07-22. If LinkedIn restructures the
 * topcard, re-capture the DOM and re-verify these anchors.
 */
export function readProfileTopcard(): { entries: RawEntry[]; headline: string | null } {
  const titleName = clean((document.title || "").split("|")[0]);

  // Current company — anchored on the topcard company icon (id starts with "company-accent").
  let company: string | null = null;
  const compIcon = document.querySelector('svg[id^="company-accent"]');
  if (compIcon) {
    const container = compIcon.closest("figure")?.parentElement;
    if (container) {
      const t = clean((container as HTMLElement).innerText);
      if (t) company = t.split("\n")[0];
    }
  }

  // Topcard = the <section> whose <h2> text matches the profile name.
  let topcard: HTMLElement | null = null;
  for (const section of Array.from(document.querySelectorAll("section"))) {
    const h2 = section.querySelector("h2");
    if (h2 && titleName && clean(h2.textContent) === titleName) {
      topcard = section;
      break;
    }
  }

  let headline: string | null = null;
  if (topcard) {
    const ps = Array.from(topcard.querySelectorAll("p"))
      .map((p) => clean(p.textContent))
      .filter(Boolean)
      .filter(
        (t) =>
          t !== titleName &&
          !t.startsWith("\u00b7") &&        // "· 1st" / "· 2nd" degree markers
          !/^[0-9,]+\+?$/.test(t) &&        // "500+" connection count
          !/connections?$/i.test(t) &&
          !/contact info/i.test(t),
      );
    if (ps.length) headline = ps[0];
    if (!company && ps.length > 1) company = ps[1];
  }

  // Represent the topcard current role as a single current entry for parseProfileRole.
  const entries: RawEntry[] =
    headline || company
      ? [{ title: headline, company, current: true, startDate: "9999-99" }]
      : [];

  return { entries, headline };
}
