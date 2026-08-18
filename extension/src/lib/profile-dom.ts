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
  const clean = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();
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
