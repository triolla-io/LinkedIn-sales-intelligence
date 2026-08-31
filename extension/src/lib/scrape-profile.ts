/**
 * SCRAPE_PROFILE task: visit a LinkedIn profile in the customer's session and read the
 * CURRENT role (title + company). The parsing is a pure, unit-tested function
 * (`parseProfileRole`); `scrapeProfile` adds only the tab navigation, mirroring the flow
 * used by `background.ts`'s `scrapeSearch`.
 */

import { openTabInAutomationWindow, pageCall, closeAutomationTab, waitForTabLoad, sleep } from "./page";

export type { RawEntry, ExperienceItem } from "./profile-dom";
import type { RawEntry, ExperienceItem, EducationItem } from "./profile-dom";


/**
 * Pure: pick the current role to report. Prefers the most-recently-started entry among
 * those flagged `current` (a profile can have multiple "current" experience entries —
 * e.g. a stale volunteer/instructor role left marked current alongside a new main job —
 * so we cannot just take entries[0]). Falls back to parsing the headline ("Title at
 * Company") when there is no experience data at all.
 */
export function parseProfileRole(
  entries: RawEntry[],
  headline: string | null,
): { title: string | null; company: string | null } {
  const current = entries.filter((e) => e.current);
  if (current.length > 0) {
    const best = current.reduce((a, b) => ((b.startDate ?? "") > (a.startDate ?? "") ? b : a));
    return { title: best.title ?? null, company: best.company ?? null };
  }
  if (headline) {
    const m = headline.match(/^(.*?)\s+at\s+(.+)$/i);
    if (m) return { title: m[1].trim(), company: m[2].trim() };
    return { title: headline, company: null };
  }
  return { title: null, company: null };
}

// ---------- DOM extraction ----------

export interface ScrapeProfileResult {
  title: string | null;
  company: string | null;
  headline: string | null;
  about: string | null;
  experience: ExperienceItem[];
  /** Deep scrape (0.7.1). Every field the page reader returns has to be listed here AND
   *  destructured below, or it is read off LinkedIn and then silently dropped on the way
   *  to the server — which is exactly what happened to skills and education. */
  skills: string[];
  education: EducationItem[];
  /** Diagnostic: did the lazy-rendered lower page ever appear, and after how many scrolls.
   *  Without it, "this person published no experience" and "we read the page too early"
   *  are the same empty array — which is how the second one went unnoticed for weeks. */
  revealed: { scrolls: number; found: boolean; experience: boolean; education: boolean; viewport: { w: number; h: number }; page: { sections: number; headings: string[]; scrollVia: string; docHeight: number; hidden: boolean } };
}

/**
 * Navigate to `linkedinUrl` and read the whole profile the radar's person model needs
 * (topcard + About + Experience) via `READ_PROFILE_FULL`.
 *
 * Mirrors background.ts's `scrapeSearch`: open a background tab in the dedicated
 * automation window, wait for load, ask the content script to read the page, then close
 * the tab. Uses the same page.ts primitives as every other flow.
 *
 * `title`/`company` are recomputed via `parseProfileRole` from the SAME headline/company
 * READ_PROFILE_FULL reports, using the single-current-entry shape `readProfileTopcard`
 * itself would have produced — so job-change detection stays byte-identical to the
 * READ_PROFILE_TOPCARD-only path this replaces.
 */
export async function scrapeProfile(linkedinUrl: string): Promise<ScrapeProfileResult> {
  const tabId = await openTabInAutomationWindow(linkedinUrl);
  try {
    await waitForTabLoad(tabId);
    // Give the SDUI page a moment to hydrate the topcard before reading it.
    await sleep(1500);
    // The extra 800ms that used to sit here was based on a wrong diagnosis: its comment
    // said About/Experience "render a beat after the topcard", so the fix was assumed to
    // be time. It is scroll — those sections render only as they near the viewport — and
    // READ_PROFILE_FULL now scrolls for them itself, stopping as soon as they appear.
    const { headline, company, about, experience, skills, education, revealed } = await pageCall(tabId, {
      kind: "READ_PROFILE_FULL",
    });
    const entries: RawEntry[] =
      headline || company ? [{ title: headline, company, current: true, startDate: "9999-99" }] : [];
    const { title } = parseProfileRole(entries, headline);
    return { title, company, headline, about, experience, skills, education, revealed };
  } finally {
    await closeAutomationTab(tabId);
  }
}
