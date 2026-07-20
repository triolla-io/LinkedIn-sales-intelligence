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

// ---------- DOM extraction (unverified against a live profile — see TODO below) ----------

/**
 * Page-context IIFE, same mechanism as SCRAPE_FN_SOURCE in scrape-search.ts: evaluated via
 * CDP Runtime.evaluate(returnByValue), runs in the real browser DOM, and reads the
 * Experience section + headline into { entries, headline } for parseProfileRole to consume.
 *
 * TODO(live-verify): Experience-section selectors must be confirmed against a live
 * LinkedIn profile. LinkedIn's profile DOM (section ids, "Experience" heading text,
 * per-entry role/company/date structure, and how multiple positions under one company are
 * grouped) changes often and cannot be verified from this environment. The selectors below
 * are a best-effort guess mirroring the general structure LinkedIn has used historically
 * (an `#experience` anchor section containing a list of entries, each with a bold role
 * title, a company name line, and a date range ending in "Present" for current roles) —
 * they are NOT confirmed to match the current live markup.
 */
const SCRAPE_PROFILE_FN_SOURCE = `(() => {
  const headlineEl = document.querySelector('.text-body-medium.break-words')
    || document.querySelector('[data-generated-suggestion-target]')
    || document.querySelector('.pv-text-details__left-panel .text-body-medium');
  const headline = headlineEl ? headlineEl.textContent.trim() : null;

  const expSection = document.getElementById('experience')?.closest('section')
    || document.querySelector('section[id="experience"]')
    || Array.from(document.querySelectorAll('section')).find(
      (s) => /experience/i.test(s.querySelector('h2')?.textContent || '')
    );

  const entries = [];
  if (expSection) {
    const items = expSection.querySelectorAll('li.artdeco-list__item, ul > li');
    for (const item of items) {
      const text = (item.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean);
      if (text.length === 0) continue;
      const title = text[0] || null;
      const company = (text[1] || '').split(' · ')[0] || null;
      const dateLine = text.find((l) => /\\d{4}/.test(l) || /present|current|כיום|נוכחי/i.test(l)) || '';
      const current = /present|current|כיום|נוכחי/i.test(dateLine);
      const startMatch = dateLine.match(/([A-Za-z]{3,9}\\.?\\s+\\d{4}|\\d{4})/);
      const startDate = startMatch ? startMatch[1] : null;
      entries.push({ title, company, current, startDate });
    }
  }

  return { entries, headline };
})()`;

/**
 * Navigate to `linkedinUrl`, read the Experience section + headline via
 * SCRAPE_PROFILE_FN_SOURCE, and return the parsed current role.
 *
 * Mirrors background.ts's `scrapeSearch`: open a background tab in the dedicated
 * automation window, wait for load, attach CDP, evaluate the page-context extractor,
 * then detach/close. Kept in this lib file (rather than background.ts) per this task's
 * scope; it reuses the same cdp.ts primitives (`openTabInAutomationWindow`, `attach`,
 * `send`, `detach`) as every other CDP-driven flow in the extension.
 */
export async function scrapeProfile(
  linkedinUrl: string,
): Promise<{ title: string | null; company: string | null }> {
  const tabId = await openTabInAutomationWindow(linkedinUrl, false);
  let attached = false;
  try {
    await waitForTabLoad(tabId);

    // Force the background tab to render, same as forceBackgroundRender() in background.ts —
    // the Experience section is lazy/visibility-gated, so a minimized non-focused tab may
    // never paint it without this.
    await send(tabId, "Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    }).catch(() => {});

    await attach(tabId);
    attached = true;

    await send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await send(tabId, "Page.enable", {}).catch(() => {});
    await send(tabId, "Page.setWebLifecycleState", { state: "active" }).catch(() => {});

    // Give the page a moment to lazy-render the Experience section before reading it.
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
