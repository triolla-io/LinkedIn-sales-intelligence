/**
 * Background-side page driver: the dedicated automation window, tab lifecycle, and the
 * typed request/response bridge to the content script.
 *
 * This module replaces the old cdp.ts. Nothing here touches chrome.debugger, so Chrome
 * never raises the global "started debugging this browser" infobar (which appeared in
 * every tab of every window, and whose X button force-detached the session mid-send).
 */

import type { PageRequest, PageResponse, PageResults } from "./messages";

const AUTOMATION_WINDOW_KEY = "automationWindowId";

/**
 * Automation-window geometry.
 *
 * The window is deliberately NOT minimized: without CDP there is no
 * Emulation.setDeviceMetricsOverride to fake a layout viewport, and a minimized window
 * lays its tab out at 0×0 — every DOM read comes back empty. A normal, non-focused window
 * renders for real, and opens unfocused so it sits behind whatever the user is working in.
 *
 * 1440×900 matches what the old CDP path forced via setDeviceMetricsOverride (1280×900)
 * with room for browser chrome, and stays clear of LinkedIn's narrow-desktop layouts,
 * where top-card actions (Message / Connect) collapse into the "More" menu. A window
 * sized to the old *viewport* number would actually give a ~1265px viewport.
 */
const WINDOW_BOUNDS = { left: 0, top: 0, width: 1440, height: 900 } as const;

async function windowExists(id: number): Promise<boolean> {
  try {
    await chrome.windows.get(id);
    return true;
  } catch {
    return false;
  }
}

/** Get (or lazily create) the dedicated, non-focused automation window. Returns its windowId. */
export async function getAutomationWindow(): Promise<number> {
  const stored = await chrome.storage.local.get(AUTOMATION_WINDOW_KEY);
  const cached: number | undefined = stored[AUTOMATION_WINDOW_KEY];
  if (cached !== undefined && (await windowExists(cached))) return cached;
  // Stale or missing — close any orphan first, then create a fresh one.
  if (cached !== undefined) await chrome.windows.remove(cached).catch(() => {});
  const win = await chrome.windows.create({ focused: false, ...WINDOW_BOUNDS });
  if (!win?.id) throw new Error("automation_window_create_failed");
  await chrome.storage.local.set({ [AUTOMATION_WINDOW_KEY]: win.id });
  return win.id;
}

/**
 * Open a tab in the automation window and return its tabId.
 *
 * The tab is created ACTIVE on purpose: only the active tab of a visible window renders,
 * and every flow (compose, connect, scrape) reads the rendered DOM. Creating a tab active
 * in a non-focused window does not focus that window, so this never steals the screen.
 */
export async function openTabInAutomationWindow(url: string): Promise<number> {
  const windowId = await getAutomationWindow();
  const tab = await chrome.tabs.create({ windowId, url, active: true });
  if (!tab.id) throw new Error("tab_create_failed");
  return tab.id;
}

/** Called at startup: forget a stale automation-window id from a previous SW session. */
export async function closeStaleAutomationWindow(): Promise<void> {
  const stored = await chrome.storage.local.get(AUTOMATION_WINDOW_KEY);
  const cached: number | undefined = stored[AUTOMATION_WINDOW_KEY];
  if (cached !== undefined && !(await windowExists(cached))) {
    await chrome.storage.local.remove(AUTOMATION_WINDOW_KEY);
  }
  // If the window still exists from a prior session, leave it — getAutomationWindow reuses it.
}

/** Last-resort teardown: drop the whole automation window (used by the task watchdog). */
export async function discardAutomationWindow(): Promise<void> {
  const stored = await chrome.storage.local.get(AUTOMATION_WINDOW_KEY);
  const cached: number | undefined = stored[AUTOMATION_WINDOW_KEY];
  if (cached !== undefined) {
    await chrome.windows.remove(cached).catch(() => {});
    await chrome.storage.local.remove(AUTOMATION_WINDOW_KEY);
  }
}

/**
 * Close an automation tab, clearing any unsent draft first.
 *
 * The draft clear is what keeps the native "Leave site?" prompt away: LinkedIn arms a
 * beforeunload handler while a draft exists, chrome.tabs.remove respects it, and we no
 * longer hold a CDP session that could auto-accept the dialog. Best-effort — a tab that
 * has already navigated away or died just closes.
 */
export async function closeAutomationTab(tabId: number): Promise<void> {
  await pageCall(tabId, { kind: "CLEAR_DRAFT" }, { retries: 1 }).catch(() => {});
  await chrome.tabs.remove(tabId).catch(() => {});
}

/** Navigate an automation tab, clearing any draft first (same beforeunload reason). */
export async function navigateTab(tabId: number, url: string): Promise<void> {
  await pageCall(tabId, { kind: "CLEAR_DRAFT" }, { retries: 1 }).catch(() => {});
  await chrome.tabs.update(tabId, { url });
}

/** PNG screenshot (base64) of the automation tab, for failure diagnostics. */
export async function takeScreenshot(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

interface PageCallOptions {
  /** How many times to re-send while the content script is still coming up. */
  retries?: number;
  /** Delay between retries, ms. */
  retryDelayMs?: number;
}

/**
 * Send one typed request to the content script and return its result.
 *
 * Retries while the receiving end is missing: content scripts inject at document_idle, so
 * a call issued right after a navigation can land before the script exists. Anything else
 * (an error thrown inside the page routine) is surfaced immediately.
 */
export async function pageCall<K extends PageRequest["kind"]>(
  tabId: number,
  request: Extract<PageRequest, { kind: K }>,
  { retries = 40, retryDelayMs = 250 }: PageCallOptions = {},
): Promise<PageResults[K]> {
  let lastError = "content_script_unreachable";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);
    let response: PageResponse<K> | undefined;
    try {
      response = (await chrome.tabs.sendMessage(tabId, request)) as PageResponse<K>;
    } catch (err) {
      // "Receiving end does not exist" — the script is not up yet (or the tab navigated).
      lastError = String((err as Error)?.message ?? err);
      continue;
    }
    if (!response) {
      lastError = "empty_response";
      continue;
    }
    if (response.ok) return response.result;
    throw withCode(
      new Error(`${request.kind}: ${response.errorMessage ?? response.errorCode}`),
      response.errorCode,
    );
  }
  throw withCode(
    new Error(`${request.kind}: content script unreachable (${lastError})`),
    "page_unreachable",
  );
}

/** Resolve once the tab reports status "complete". */
export async function waitForTabLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  // Fast path: the tab may already be "complete" before we attach the listener. This is
  // common for tabs in a non-focused automation window, where the onUpdated "complete"
  // event can fire before this function runs.
  const existing = await chrome.tabs.get(tabId).catch(() => null);
  if (existing?.status === "complete") return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(listener);
      fn();
    };
    const timeout = setTimeout(
      () => finish(() => reject(withCode(new Error("tab_load_timeout"), "tab_load"))),
      timeoutMs,
    );
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") finish(resolve);
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Backstop poll: covers the case where the "complete" event is missed entirely
    // (throttled background window) but the tab did finish loading.
    const poll = setInterval(async () => {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (!t) return finish(() => reject(withCode(new Error("tab_closed"), "tab_load")));
      if (t.status === "complete") finish(resolve);
    }, 1000);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
