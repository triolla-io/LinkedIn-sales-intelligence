/**
 * SCRAPE_PROFILE task: visit a LinkedIn profile in the customer's session and read the
 * CURRENT role (title + company). The parsing is a pure, unit-tested function
 * (`parseProfileRole`); `scrapeProfile` adds only the tab navigation, mirroring the flow
 * used by `background.ts`'s `scrapeSearch`.
 */

import { openTabInAutomationWindow, pageCall, closeAutomationTab, waitForTabLoad, sleep } from "./page";

export type { RawEntry } from "./profile-dom";
import type { RawEntry } from "./profile-dom";


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

/**
 * Navigate to `linkedinUrl`, read the current role from the topcard via
 * `readProfileTopcard`, and return the parsed current role.
 *
 * Mirrors background.ts's `scrapeSearch`: open a background tab in the dedicated
 * automation window, wait for load, ask the content script to read the topcard, then
 * close the tab. Uses the same page.ts primitives as every other flow.
 */
export async function scrapeProfile(
  linkedinUrl: string,
): Promise<{ title: string | null; company: string | null }> {
  const tabId = await openTabInAutomationWindow(linkedinUrl);
  try {
    await waitForTabLoad(tabId);
    // Give the SDUI page a moment to hydrate the topcard before reading it.
    await sleep(1500);
    const { entries, headline } = await pageCall(tabId, { kind: "READ_PROFILE_TOPCARD" });
    return parseProfileRole(entries, headline);
  } finally {
    await closeAutomationTab(tabId);
  }
}
