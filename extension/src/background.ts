import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat } from "./lib/api";
import { attach, detach, click, clickSendButton, closeAllComposeOverlays, clickModalClose, getComposeUrl, typeIntoCompose, composeDiag, takeScreenshot, scrollBy, scanButtons, send, openTabInAutomationWindow, closeStaleAutomationWindow } from "./lib/cdp";
import { PROFILE_STATE_FN_SOURCE } from "./lib/dom-detect";

// ---------- Shared types ----------

export type ScrapedCard = {
  urn: string;
  profileUrl: string;
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: string | null;
};

const POLL_INTERVAL_S = 30;
const HEARTBEAT_INTERVAL_S = 60;
const VERSION = "0.3.2";

// In-memory semaphore (fast, race-free in single-threaded JS).
let taskRunning = false;

// Track the tab opened by the current task in local storage so orphaned tabs
// can be closed if the service worker is restarted mid-task.
async function trackActiveTab(tabId: number) {
  await chrome.storage.local.set({ swActiveTabId: tabId });
}
async function clearActiveTab() {
  await chrome.storage.local.remove("swActiveTabId");
}

// On every SW startup: close any tab left open from a previous killed run.
(async () => {
  try {
    await closeStaleAutomationWindow().catch(() => {});
    const { swActiveTabId } = await chrome.storage.local.get("swActiveTabId");
    if (swActiveTabId) {
      console.log("[startup] closing orphaned tab", swActiveTabId);
      await chrome.tabs.remove(swActiveTabId).catch(() => {});
      await clearActiveTab();
    }
  } catch (e) {
    console.warn("[startup] cleanup error", e);
  }
})();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("poll", { periodInMinutes: POLL_INTERVAL_S / 60 });
  chrome.alarms.create("hb", { periodInMinutes: HEARTBEAT_INTERVAL_S / 60 });
});

// Send heartbeat immediately on service-worker startup so the UI shows
// "connected" right away instead of waiting up to 60s for the first alarm.
getToken().then((token) => { if (token) heartbeat(VERSION); });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "heartbeat") heartbeat(VERSION);
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (!(await getToken())) return;
  if (await isPaused()) return;
  if (a.name === "hb") { await heartbeat(VERSION); return; }
  if (a.name === "poll") {
    if (taskRunning) { console.log("[poll] task already running, skipping"); return; }
    // Drain the queue: keep polling until no tasks remain
    while (true) {
      const hadTask = await runOneCycle();
      if (!hadTask) break;
    }
  }
});

// Returns true if a task was found and processed
async function runOneCycle(): Promise<boolean> {
  let task;
  try { task = await pollTask(); } catch (e) { console.warn("poll error", e); return false; }
  if (!task) return false;

  taskRunning = true;
  try {
    const result = await executeTask(task);
    await reportResult(task.id, { ok: true, result });
  } catch (err) {
    const errorCode = (err as Error & { code?: string }).code ?? "unknown";
    const screenshot = (err as Error & { screenshot?: string }).screenshot;
    const buttons = (err as Error & { buttons?: unknown }).buttons;
    const diag = (err as Error & { diag?: unknown }).diag;
    await reportResult(task.id, {
      ok: false,
      errorCode,
      errorMessage: (err as Error).message,
      ...(screenshot || buttons || diag ? { result: { debugScreenshot: screenshot, buttons, diag } } : {}),
    });
  } finally {
    taskRunning = false;
  }
  return true;
}

async function executeTask(task: { id: string; kind: "SEND" | "CHECK_REPLY" | "SEARCH" | "CONNECT"; payload: unknown }): Promise<unknown> {
  const payload = task.payload as {
    linkedinUrl?: string;
    conversationUrl?: string;
    text?: string;
    sinceIso?: string;
    searchUrl?: string;
    page?: number;
    profileUrl?: string;
    recipientName?: string;
  };

  if (task.kind === "SEND") {
    if (!payload.linkedinUrl || !payload.text) throw withCode(new Error("missing_payload"), "bad_payload");
    return await sendLinkedInMessage(payload.linkedinUrl, payload.text, payload.recipientName ?? "");
  }

  if (task.kind === "CHECK_REPLY") {
    return { replyDetected: false, replies: [] };
  }

  if (task.kind === "SEARCH") {
    if (!payload.searchUrl) throw withCode(new Error("missing_payload"), "bad_payload");
    return await scrapeSearch(payload.searchUrl);
  }

  if (task.kind === "CONNECT") {
    if (!payload.profileUrl) throw withCode(new Error("missing_payload"), "bad_payload");
    return await sendConnectRequest(payload.profileUrl);
  }

  throw withCode(new Error("unknown_kind"), "bad_payload");
}

// Collect environment hints to diagnose tab-hijack / extension-conflict failures
// remotely (the result is persisted to the DB). Captures the tab's actual state and
// the list of installed extensions — when another extension redirects our LinkedIn
// tab to its own chrome-extension:// page, chrome.debugger.attach fails with
// "Cannot access a chrome-extension:// URL of different extension", and this reveals
// WHICH extension (the offending id appears both in the hijacked URL and this list).
async function gatherEnvHints(tabId: number): Promise<Record<string, unknown>> {
  const hints: Record<string, unknown> = {};
  try {
    const t = await chrome.tabs.get(tabId);
    hints.tabUrl = t.url ?? null;
    hints.tabStatus = t.status ?? null;
    hints.tabTitle = t.title ?? null;
    hints.windowId = t.windowId ?? null;
  } catch (e) {
    hints.tabGetError = String((e as Error)?.message ?? e);
  }
  try {
    if (chrome.management?.getAll) {
      const all = await chrome.management.getAll();
      hints.extensions = all
        .filter((x) => x.type === "extension")
        .map((x) => ({ id: x.id, name: x.name, enabled: x.enabled }));
    } else {
      hints.extensions = "management_api_unavailable";
    }
  } catch (e) {
    hints.managementError = String((e as Error)?.message ?? e);
  }
  return hints;
}

async function sendLinkedInMessage(profileUrl: string, text: string, recipientName = ""): Promise<{ sentAt: string; conversationUrl: string; steps: number }> {
  // Open a BLANK tab first, NOT the profile URL. chrome.debugger.attach is refused
  // when the target tab already hosts frames belonging to OTHER extensions — e.g.
  // HubSpot Sales / Datanyze inject chrome-extension:// frames into every linkedin.com
  // page, so attaching to an already-loaded profile fails with "Cannot access a
  // chrome-extension:// URL of different extension". Attaching while the tab is still
  // about:blank passes Chrome's attach-time security check; the debugger session then
  // persists across the CDP navigation to LinkedIn, even as those extensions inject.
  // Open the blank tab inside the dedicated, minimized, non-focused automation window
  // (same path the search/scrape flows use) so a send never steals the user's screen.
  // CDP input (Input.dispatchMouseEvent / insertText) and JS .click() are dispatched
  // straight to the renderer, so they work on a minimized, non-focused tab — the old
  // bring-to-front was unnecessary.
  // active:false — the send flow drives the page purely via selectors / CDP (no innerText),
  // so the tab never needs to be foregrounded. An inactive tab never restores the minimized
  // automation window, so a send no longer pops to the foreground / takes over the screen.
  const tabId = await openTabInAutomationWindow("about:blank", false);
  await trackActiveTab(tabId);

  let attached = false;
  let caughtError: Error | null = null;

  try {
    // Attach on the blank page (no foreign frames yet), then drive navigation via CDP.
    await waitForTabLoad(tabId);
    await attach(tabId);
    attached = true;

    // A never-foregrounded tab can lay out at 0×0, which would zero every
    // getBoundingClientRect() and break visibility checks (getComposeUrl, Send button).
    // Force a real layout viewport so the page renders as if visible, without showing it.
    await send(tabId, "Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    }).catch(() => {});

    // Navigate to the profile through the already-attached debugger session.
    await send(tabId, "Page.navigate", { url: profileUrl });
    await waitForTabLoad(tabId);
    await sleep(2500);

    const preTab = await chrome.tabs.get(tabId);
    if (preTab.url && preTab.url.includes("/checkpoint")) {
      throw withCode(new Error("checkpoint"), "checkpoint");
    }

    // Close any compose overlays left from previous attempts (returns void).
    await closeAllComposeOverlays(tabId);
    await sleep(500);

    // Dismiss any promotional popup (e.g. LinkedIn's "upgrade to Premium" interstitial)
    // that may have loaded after the initial Escape sweep. These popups appear randomly
    // and occlude the Message button so the CDP click lands on the overlay instead.
    // clickModalClose looks for a visible Dismiss/Close/× button and clicks it.
    const dismissed = await clickModalClose(tabId);
    if (dismissed) {
      console.log("[agent] dismissed popup before Message click");
      await sleep(500);
    }

    // Phase 1: extract the compose URL from the Message button's href, then navigate
    // directly to /messaging/compose/. This is more reliable than clicking the button
    // and waiting for an overlay — the full messaging page always renders a proper
    // contenteditable that enables React-driven Send, whereas the overlay's Send button
    // can stay disabled if execCommand doesn't fire the right synthetic events.
    const composeUrl = await getComposeUrl(tabId);
    if (!composeUrl) throw withCode(new Error("message_button_not_found"), "not_messageable");
    console.log("[agent] composeUrl:", composeUrl);

    await chrome.tabs.update(tabId, { url: composeUrl });
    await waitForTabLoad(tabId);

    // The Message-button navigation reuses the already-"complete" profile tab, so
    // waitForTabLoad's fast path can return before the compose page has even begun
    // loading. A fixed sleep then races the SPA render: if it loses, typeIntoCompose
    // runs against the profile (no compose box) and fails with compose_insert_failed
    // — the captured url= in those failures was the profile, not /messaging/compose/.
    // Poll until LinkedIn's compose box actually exists before typing.
    let navDiag = await composeDiag(tabId);
    const composeDeadline = Date.now() + 15_000;
    while (
      Date.now() < composeDeadline &&
      (navDiag.msgForm as number) === 0 &&
      (navDiag.anyEditable as number) === 0
    ) {
      await sleep(500);
      navDiag = await composeDiag(tabId);
    }
    console.log("[agent] post-nav diag:", navDiag);

    // Phase 2: type the message with CDP Input.insertText (triggers React onChange).
    // The full messaging page has a stable contenteditable — no retries needed.
    const typed = await typeIntoCompose(tabId, text);
    console.log("[agent] typeIntoCompose:", typed);
    if (!typed) {
      throw withCode(
        new Error(`compose_insert_failed diag=${JSON.stringify(navDiag)}`),
        "compose_insert_failed",
      );
    }
    await sleep(600);

    // Phase 3: click Send button (enabled after proper typing).
    const sent = await clickSendButton(tabId);
    console.log("[agent] clickSendButton:", sent);
    if (!sent) throw withCode(new Error("send_button_not_found"), "send_button_not_found");
    await sleep(1500);

    return { sentAt: new Date().toISOString(), conversationUrl: profileUrl, steps: 3 };
  } catch (err) {
    caughtError = err as Error;
    const failedTab = await chrome.tabs.get(tabId).catch(() => null);
    if (failedTab?.url) caughtError.message = `${caughtError.message} (url=${failedTab.url})`;
    // Always gather environment hints (tab state + installed extensions), even when
    // the failure happened before attach — this is exactly when we need them.
    (caughtError as Error & { diag?: unknown }).diag = await gatherEnvHints(tabId).catch(() => ({ diagError: true }));
    if (attached) {
      try {
        const [screenshot, buttons] = await Promise.all([
          takeScreenshot(tabId),
          scanButtons(tabId),
        ]);
        (caughtError as Error & { screenshot?: string; buttons?: unknown }).screenshot = screenshot;
        (caughtError as Error & { buttons?: unknown }).buttons = buttons;
      } catch { /* ignore */ }
    }
    throw caughtError;
  } finally {
    if (attached) await detach(tabId).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
    await clearActiveTab();
  }
}

// ---------- SEARCH: scrape LinkedIn search results page ----------

// Parse LinkedIn people-search result cards.
//
// CRITICAL: LinkedIn renders each field of a result card on its OWN line, so the card's
// innerText carries the structure in its newlines (name / "2nd degree connection" / headline /
// location / mutual-connections / button labels). The previous version collapsed all whitespace
// (\\s+ -> ' ') BEFORE parsing, destroying every newline — so the line-based splits downstream
// were dead, the "X at Y" regex matched the first "at" anywhere in the blob, the "2nd" degree token
// got sliced into a stray "nd", and location was never recovered. We MUST keep the lines intact and
// parse line-by-line. Degree/location are no longer used for filtering (the search URL already
// constrains 2nd-degree + geo — see lib/prospecting/filter.ts), but clean values still drive the UI.
const SCRAPE_FN_SOURCE = `(() => {
  const section = document.querySelector('section[aria-label="Primary content"]');
  if (!section) return { candidates: [], hasNextPage: false };
  const allLinks = Array.from(section.querySelectorAll('a[href*="/in/"]'));
  const seen = new Set();
  const out = [];
  // Lines that are chrome, not profile data: buttons, the "View X's profile" a11y label,
  // the degree-connection caption, mutual-connection / follower counts, presence status.
  const NOISE = /(^view .*profile$|^message$|^connect$|^follow$|^following$|^pending$|^save$|^more$|degree connection$|mutual connection|other mutual|\\bfollowers?$|^status is |^• )/i;
  for (const link of allLinks) {
    const profileUrl = link.href.split('?')[0];
    if (seen.has(profileUrl) || !profileUrl.match(/linkedin\\.com\\/in\\/[^\\/]+\\/?$/)) continue;
    seen.add(profileUrl);
    // derive a stable urn from the profile slug
    const slug = profileUrl.replace(/\\/$/, '').split('/in/')[1] || '';
    const urn = 'urn:li:member:' + slug;
    // The whole result card. LinkedIn search results are <li> items; fall back to walking up.
    const card = link.closest('li') || link.parentElement?.parentElement?.parentElement || link.parentElement;
    // Keep the line structure (do NOT collapse newlines). Trim each line, drop blanks, and drop
    // consecutive duplicates (LinkedIn repeats the name for screen readers).
    let lines = (card ? card.innerText : '').split('\\n').map(s => s.replace(/\\s+/g, ' ').trim()).filter(Boolean);
    lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
    // name: first line of the link's own text, minus the degree badge / favourite star / "+N" badge.
    const nameRaw = (link.innerText || '').split('\\n')[0].trim();
    const name = nameRaw.replace(/\\s*•\\s*(1st|2nd|3rd\\+?).*/, '').replace(/\\s*★.*/, '').replace(/\\+\\d+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!name || name.length < 2) continue;
    // degree: first line containing a standalone 1st/2nd/3rd token (e.g. "• 2nd" or "2nd degree connection").
    let degree = null;
    for (const l of lines) {
      const m = l.match(/\\b(1st|2nd|3rd\\+?)\\b/);
      if (m) { degree = m[1].charAt(0) === '3' ? '3rd' : m[1]; break; }
    }
    // content lines = everything that isn't the name or chrome. headline first, location later.
    const content = lines.filter(l =>
      l !== name && l !== nameRaw && !NOISE.test(l) && !/^(1st|2nd|3rd\\+?)$/.test(l)
    );
    const headline = content[0] || null;
    // title + company from "Title at Company" when present; otherwise the whole headline is the title.
    let title = null, company = null;
    if (headline) {
      const at = headline.match(/^(.*?)\\s+at\\s+(.+)$/);
      if (at) { title = at[1].trim(); company = at[2].trim(); } else { title = headline; }
    }
    // location: the first later content line that reads like a place (has a comma, or names Israel).
    let location = null;
    for (let i = 1; i < content.length; i++) {
      const l = content[i];
      if (/,/.test(l) || /israel|ישראל/i.test(l)) { location = l; break; }
    }
    out.push({ urn, profileUrl, name, headline, title, company, location, degree });
  }
  const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Next');
  const next = nextBtns[0];
  const hasNextPage = !!next && !next.disabled;
  return { candidates: out, hasNextPage };
})()`;

async function scrapeSearch(searchUrl: string): Promise<{ candidates: ScrapedCard[]; hasNextPage: boolean }> {
  const tabId = await openTabInAutomationWindow(searchUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_load");
  });
  await trackActiveTab(tabId);

  let attached = false;

  try {
    await waitForTabLoad(tabId);
    await sleep(2500);
    // Do NOT focus the window — runs in the background automation window.

    // Checkpoint detection (before attach — check URL)
    const freshTab = await chrome.tabs.get(tabId);
    if (freshTab.url && freshTab.url.includes("/checkpoint")) {
      throw withCode(new Error("checkpoint"), "checkpoint");
    }

    await attach(tabId);
    attached = true;

    await send(tabId, "Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    }).catch(() => {});

    // Lazy-load by scrolling
    for (let i = 0; i < 6; i++) {
      await scrollBy(tabId, 1200);
      await sleep(800);
    }

    // Evaluate scraping function in-page, returnByValue
    const evalResult = await send<{ result: { value: { candidates: ScrapedCard[]; hasNextPage: boolean } } }>(
      tabId,
      "Runtime.evaluate",
      { expression: SCRAPE_FN_SOURCE, returnByValue: true }
    );

    const scraped = evalResult?.result?.value;
    if (!scraped) throw withCode(new Error("scrape_returned_null"), "scrape_failed");

    return scraped;
  } finally {
    if (attached) await detach(tabId).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
    await clearActiveTab();
  }
}

// ---------- CONNECT: send a LinkedIn connection request ----------

// Find the Connect button using direct DOM query (works regardless of UI language).
//
// Two live-LinkedIn pitfalls this guards against:
//   1. A profile renders the Connect action TWICE — once in the main top-card and once in a
//      sticky header that is positioned behind the global nav. The sticky-header copy reports a
//      valid bounding box but is occluded, so a synthetic click lands on the nav and nothing opens.
//      We use document.elementFromPoint() to keep only the instance that is actually clickable.
//   2. The "People also viewed" sidebar lists Connect buttons for OTHER members. Their
//      custom-invite href carries a different vanityName, so we scope to the target profile's slug.
async function findConnectButtonDirect(
  tabId: number,
  slug: string,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const result = await send<{ result: { value: unknown } }>(tabId, "Runtime.evaluate", {
    expression: `(() => {
      const slug = ${JSON.stringify(slug)};
      const cands = [...document.querySelectorAll(
        'a[href*="custom-invite" i], button[aria-label*="invite" i], button[aria-label*="connect" i], a[aria-label*="connect" i], [role="button"][aria-label*="invite" i]'
      )];
      let fallback = null;
      for (const el of cands) {
        const href = (el.getAttribute('href') || '').toLowerCase();
        // Skip custom-invite links that target a DIFFERENT member (sidebar suggestions).
        if (href.includes('custom-invite') && slug && !href.includes('vanityname=' + slug)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        const at = document.elementFromPoint(cx, cy);
        const clickable = !!at && (at === el || el.contains(at) || at.contains(el));
        if (!clickable) continue; // occluded (e.g. sticky-header copy behind the nav)
        const box = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        // Prefer a slug-scoped match; otherwise remember the first clickable connect/invite.
        if (href.includes('custom-invite') && slug && href.includes('vanityname=' + slug)) return box;
        if (!fallback) fallback = box;
      }
      return fallback;
    })()`,
    returnByValue: true,
  });
  return (result?.result?.value as { x: number; y: number; w: number; h: number } | null) ?? null;
}

// Find the "Send without a note" (or "Send") button inside the invite dialog.
// LinkedIn renders this modal inside a SHADOW ROOT (the "interop-outlet" web-component layer),
// so a plain document.querySelectorAll() never sees it — the lookup must pierce shadow roots.
async function findSendButtonDeep(
  tabId: number,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const result = await send<{ result: { value: unknown } }>(tabId, "Runtime.evaluate", {
    expression: `(() => {
      let dlg = null;
      const findDlg = (root) => {
        if (dlg) return;
        const m = root.querySelector('[role="dialog"], .artdeco-modal');
        if (m) { dlg = m; return; }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { findDlg(el.shadowRoot); if (dlg) return; }
      };
      findDlg(document);
      const scope = dlg || document;
      // Match the invite dialog's Send action across LinkedIn's variants:
      // "Send" / "Send invitation" / "Send now" / "Send without a note" (+ Hebrew). Anchored to the
      // START of the text so "Resend"/unrelated buttons don't match, but NOT requiring an exact word.
      const SEND = [/^send\\b/i, /send without/i, /^שלח/, /שלח ללא/];
      const SKIP = /cancel|בטל|add a note|הוסף הערה|dismiss|got it|close|סגור/i;
      let found = null, primary = null;
      const collect = (root) => {
        if (found) return;
        for (const el of root.querySelectorAll('button,[role="button"]')) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const box = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
          const t = (el.textContent || '').trim();
          const a = el.getAttribute('aria-label') || '';
          if (SEND.some(p => p.test(t) || p.test(a))) { found = box; return; }
          // Fallback: remember the dialog's primary action button (the invite "Send" on dialogs
          // whose label we don't recognise), excluding Cancel / Add-a-note / Dismiss.
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!primary && /artdeco-button--primary/.test(cls) && !SKIP.test(t + ' ' + a)) primary = box;
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { collect(el.shadowRoot); if (found) return; }
      };
      collect(scope);
      // Only trust the primary-button fallback when we actually located the invite dialog, so we
      // never click a stray primary button elsewhere on the page when no dialog opened.
      return found || (dlg ? primary : null);
    })()`,
    returnByValue: true,
  });
  return (result?.result?.value as { x: number; y: number; w: number; h: number } | null) ?? null;
}

async function sendConnectRequest(profileUrl: string): Promise<{ sentAt: string }> {
  // Open a BLANK tab and attach BEFORE navigating to LinkedIn. Attaching to an
  // already-loaded profile fails ("Cannot access a chrome-extension:// URL of
  // different extension") when HubSpot/Datanyze inject chrome-extension:// frames
  // into linkedin.com. Attaching while about:blank passes the attach-time check;
  // the session then survives the CDP navigation. Same pattern as sendLinkedInMessage.
  const tabId = await openTabInAutomationWindow("about:blank", false).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_load");
  });
  await trackActiveTab(tabId);

  let attached = false;

  try {
    await waitForTabLoad(tabId);
    await attach(tabId);
    attached = true;

    // A never-foregrounded tab in the minimized automation window can lay out at
    // 0×0, zeroing every getBoundingClientRect() so the Connect/Send coordinate
    // clicks miss. Force a real layout viewport (same as the message flow).
    await send(tabId, "Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    }).catch(() => {});

    // Navigate to the profile through the already-attached debugger session.
    await send(tabId, "Page.navigate", { url: profileUrl });
    await waitForTabLoad(tabId);
    await sleep(4000);

    // Checkpoint detection
    const freshTab = await chrome.tabs.get(tabId);
    if (freshTab.url && freshTab.url.includes("/checkpoint")) {
      throw withCode(new Error("checkpoint"), "checkpoint");
    }

    // The target profile's vanityName (slug) — used to scope the Connect button to THIS person
    // and exclude "People also viewed" sidebar suggestions.
    const slug = (profileUrl.split("/in/")[1] ?? "").replace(/[/?#].*/, "").toLowerCase();

    // Try direct CSS selector first (most reliable — LinkedIn profile action buttons).
    // aria-label contains "Connect" or "Invite" in English regardless of UI language.
    let connectBtn = await findConnectButtonDirect(tabId, slug);
    console.log("[connect] directBtn:", connectBtn);

    if (!connectBtn) {
      // Fallback: scan visible buttons
      let buttons = await scanButtons(tabId);
      console.log("[connect] buttons found:", buttons.map(b => `"${b.text}" aria="${b.aria}" y=${b.y}`));
      connectBtn = buttons.find((b) => /^connect$/i.test(b.text) || /connect/i.test(b.aria)) ?? null;

      if (!connectBtn) {
        // Try "More" dropdown
        const moreBtn = buttons.find((b) => /^more$/i.test(b.text) || /^more$/i.test(b.aria));
        if (moreBtn) {
          await click(tabId, moreBtn.x + Math.round(moreBtn.w / 2), moreBtn.y + Math.round(moreBtn.h / 2));
          await sleep(700);
          buttons = await scanButtons(tabId);
          console.log("[connect] buttons after More:", buttons.map(b => `"${b.text}" aria="${b.aria}" y=${b.y}`));
          connectBtn = buttons.find((b) => /^connect$/i.test(b.text) || /connect/i.test(b.aria)) ?? null;
          if (!connectBtn) {
            // Also try direct selector again after More opens
            connectBtn = await findConnectButtonDirect(tabId, slug);
          }
        }
      }
    }

    if (!connectBtn) {
      const stateRes = await send<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
        expression: PROFILE_STATE_FN_SOURCE,
        returnByValue: true,
      });
      const state = stateRes?.result?.value;
      if (state === "pending") throw withCode(new Error("invitation_already_pending"), "already_pending");
      if (state === "connected") throw withCode(new Error("already_connected"), "already_connected");

      throw withCode(new Error("connect_button_not_found"), "no_connect");
    }

    // Click Connect
    await click(tabId, connectBtn.x + Math.round((connectBtn.w ?? 80) / 2), connectBtn.y + Math.round((connectBtn.h ?? 36) / 2));

    // The invite dialog opens inside a shadow root and can take a moment to render.
    // Poll the shadow-piercing finder instead of a single fixed-delay query.
    let sendCoords: { x: number; y: number; w: number; h: number } | null = null;
    for (let i = 0; i < 6; i++) {
      await sleep(i === 0 ? 1500 : 800);
      sendCoords = await findSendButtonDeep(tabId);
      if (sendCoords) break;
    }
    console.log("[connect] sendBtn:", sendCoords);

    if (!sendCoords) {
      const afterButtons = await scanButtons(tabId);
      console.log("[connect] afterButtons:", afterButtons.map(b => `"${b.text}" aria="${b.aria}"`));
      // Surface the buttons that WERE on screen in the error message itself, so the dashboard's
      // "recent failures" reveals exactly what LinkedIn rendered (vs. guessing at the dialog).
      const labels = afterButtons
        .map(b => (b.text || b.aria || "").trim())
        .filter(Boolean)
        .slice(0, 12)
        .join(" | ");
      throw withCode(new Error(`send_dialog_not_found; buttons=[${labels}]`), "already_or_blocked");
    }

    await click(tabId, sendCoords.x + Math.round(sendCoords.w / 2), sendCoords.y + Math.round(sendCoords.h / 2));
    await sleep(800);

    return { sentAt: new Date().toISOString() };
  } catch (err) {
    const e = err as Error & { code?: string; screenshot?: string; buttons?: unknown };
    const failedTab = await chrome.tabs.get(tabId).catch(() => null);
    if (failedTab?.url) e.message = `${e.message} (url=${failedTab.url})`;
    // Don't attach heavy diagnostics for benign already_* or checkpoint outcomes.
    if (attached && e.code !== "already_pending" && e.code !== "already_connected" && e.code !== "checkpoint") {
      try {
        const [screenshot, buttons] = await Promise.all([takeScreenshot(tabId), scanButtons(tabId)]);
        e.screenshot = screenshot;
        e.buttons = buttons;
      } catch { /* ignore */ }
    }
    throw e;
  } finally {
    if (attached) await detach(tabId).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
    await clearActiveTab();
  }
}

async function waitForTabLoad(tabId: number): Promise<void> {
  // Fast path: the tab may already be "complete" before we attach the listener.
  // This is common for tabs in a non-focused automation window, where the
  // onUpdated "complete" event can fire before this function runs — in which
  // case a listener-only wait would hang until the timeout (tab_load_timeout).
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
      30_000,
    );
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") finish(resolve);
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Backstop poll: covers the case where the "complete" event is missed
    // entirely (throttled background window) but the tab did finish loading.
    const poll = setInterval(async () => {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (!t) return finish(() => reject(withCode(new Error("tab_closed"), "tab_load")));
      if (t.status === "complete") finish(resolve);
    }, 1000);
  });
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
