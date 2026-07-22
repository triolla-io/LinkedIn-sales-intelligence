/**
 * SCRAPE_PROFILE task: visit a LinkedIn profile in the customer's session and read the
 * CURRENT role (title + company). The parsing is a pure, unit-tested function
 * (`parseProfileRole`); `scrapeProfile` adds only the DOM navigation/eval, mirroring the
 * navigation + CDP-eval flow used by `scrape-search.ts` / `background.ts`'s `scrapeSearch`.
 */

import { attach, detach, send, openTabInAutomationWindow } from "./cdp";

export interface RawEntry {
  title: string | null;
  company: string | null;
  current: boolean;
  startDate: string | null;
}

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
 * Page-context IIFE, evaluated via CDP Runtime.evaluate(returnByValue). Reads the CURRENT
 * role from the profile TOP CARD, which is LinkedIn's own "primary current role" display —
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
const SCRAPE_PROFILE_FN_SOURCE = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const titleName = clean((document.title || '').split('|')[0]);

  // Current company — anchored on the topcard company icon (id starts with "company-accent").
  let company = null;
  const compIcon = document.querySelector('svg[id^="company-accent"]');
  if (compIcon) {
    const fig = compIcon.closest('figure');
    const container = fig && fig.parentElement;
    if (container) {
      const t = clean(container.innerText || '');
      if (t) company = t.split('\\n')[0];
    }
  }

  // Topcard = the <section> whose <h2> text matches the profile name.
  let topcard = null;
  const sections = Array.from(document.querySelectorAll('section'));
  for (const s of sections) {
    const h2 = s.querySelector('h2');
    if (h2 && clean(h2.textContent) === titleName && titleName) { topcard = s; break; }
  }

  let headline = null;
  if (topcard) {
    const ps = Array.from(topcard.querySelectorAll('p'))
      .map((p) => clean(p.textContent))
      .filter(Boolean)
      .filter((t) =>
        t !== titleName &&
        !t.startsWith('\\u00b7') &&              // "· 1st" / "· 2nd" degree markers
        !/^[0-9,]+\\+?$/.test(t) &&              // "500+" connection count
        !/connections?$/i.test(t) &&
        !/contact info/i.test(t));
    if (ps.length) headline = ps[0];
    if (!company && ps.length > 1) company = ps[1];
  }

  // Represent the topcard current role as a single current entry for parseProfileRole.
  const entries = (headline || company)
    ? [{ title: headline, company: company, current: true, startDate: '9999-99' }]
    : [];

  return { entries, headline };
})()`;

/**
 * Navigate to `linkedinUrl`, read the current role from the topcard via
 * SCRAPE_PROFILE_FN_SOURCE, and return the parsed current role.
 *
 * Mirrors background.ts's `scrapeSearch`: open a background tab in the dedicated
 * automation window, wait for load, force-render, attach CDP, evaluate the page-context
 * extractor, then detach/close. Reuses the same cdp.ts primitives as every other
 * CDP-driven flow in the extension.
 */
export async function scrapeProfile(
  linkedinUrl: string,
): Promise<{ title: string | null; company: string | null }> {
  const tabId = await openTabInAutomationWindow(linkedinUrl, false);
  let attached = false;
  try {
    await waitForTabLoad(tabId);

    // Force the background tab to render (the topcard is visibility-gated; a minimized
    // non-focused tab may not paint it) — same as forceBackgroundRender() in background.ts.
    await send(tabId, "Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    }).catch(() => {});

    await attach(tabId);
    attached = true;

    await send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await send(tabId, "Page.enable", {}).catch(() => {});
    await send(tabId, "Page.setWebLifecycleState", { state: "active" }).catch(() => {});

    // Give the SDUI page a moment to hydrate the topcard before reading it.
    await sleep(1500);

    const result = await send<{ result: { value: { entries: RawEntry[]; headline: string | null } } }>(
      tabId,
      "Runtime.evaluate",
      { expression: SCRAPE_PROFILE_FN_SOURCE, returnByValue: true },
    );
    const { entries, headline } = result?.result?.value ?? { entries: [], headline: null };
    return parseProfileRole(entries, headline);
  } finally {
    if (attached) await detach(tabId).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

// Minimal local tab-load wait (poll-based) — background.ts's waitForTabLoad is not exported
// from cdp.ts, so this mirrors its polling fallback rather than duplicating the full
// listener + timeout implementation.
async function waitForTabLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("tab_closed");
    if (tab.status === "complete") return;
    await sleep(500);
  }
  throw new Error("tab_load_timeout");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
