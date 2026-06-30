import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat } from "./lib/api";
import { attach, detach, clickSendButton, closeAllComposeOverlays, clickModalClose, getComposeUrl, typeIntoCompose, composeDiag, takeScreenshot, scrollBy, scanButtons, send, openTabInAutomationWindow, closeStaleAutomationWindow } from "./lib/cdp";
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
const VERSION = "0.3.4";

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

// Find AND click the Connect button in-page via element.click().
//
// Why in-page .click() instead of a coordinate click: in the minimized, never-foregrounded
// automation window getBoundingClientRect()/elementFromPoint() are unreliable (the page can lay
// out at 0×0), so coordinate clicks miss — the root cause of both no_connect (Connect button
// "not found" because its rect was 0×0) and already_or_blocked (the invite dialog's Send button
// rejected for the same reason). element.click() dispatches straight to the element regardless of
// layout, scroll, or occlusion, so the old sticky-header-occlusion guard is no longer needed.
//
// We still exclude the "People also viewed" / "More profiles" sidebar (which renders Connect
// buttons for OTHER members) and prefer the slug-scoped custom-invite link for the target profile.
async function clickConnectInPage(tabId: number, slug: string): Promise<boolean> {
  const result = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
    expression: `(() => {
      const slug = ${JSON.stringify(slug)};
      const all = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll('button, a, [role="button"]')) all.push(el);
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      const inSidebar = (el) => {
        let p = el;
        while (p) {
          if (p.tagName === 'ASIDE') return true;
          const cls = typeof p.className === 'string' ? p.className : '';
          if (/similar|browsemap|pymk|discovery/i.test(cls)) return true;
          p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null;
        }
        return false;
      };
      const isConnect = (el) => {
        const t = (el.textContent || '').trim();
        const a = el.getAttribute('aria-label') || '';
        const href = (el.getAttribute('href') || '').toLowerCase();
        if (href.includes('custom-invite')) return !(slug && !href.includes('vanityname=' + slug));
        if (/invite\\b.*\\bto connect/i.test(a) || /^connect$/i.test(a)) return true;
        if (/^(connect|התחבר)$/i.test(t)) return true;
        return false;
      };
      const cands = all.filter(isConnect);
      const slugMatch = cands.find(el => (el.getAttribute('href') || '').toLowerCase().includes('vanityname=' + slug));
      const mainCard = cands.find(el => !inSidebar(el));
      const target = slugMatch || mainCard || cands[0];
      if (target) { target.click(); return true; }
      return false;
    })()`,
    returnByValue: true,
  });
  return result?.result?.value === true;
}

// Find AND click the Send button in the invite dialog ("Add a note to your invitation?") in-page.
// LinkedIn may render this modal inside a shadow root, so the lookup pierces shadow roots. We click
// via element.click() (not coordinates) so a 0×0 layout in the minimized automation window can't
// make us miss. Matches the Send action across variants — "Send" / "Send invitation" / "Send now" /
// "Send without a note" (+ Hebrew) — and falls back to the dialog's primary action button.
async function clickSendInPage(tabId: number): Promise<boolean> {
  const result = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
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
      const SEND = [/^send\\b/i, /send without/i, /^שלח/, /שלח ללא/];
      const SKIP = /cancel|בטל|add a note|הוסף הערה|dismiss|got it|close|סגור/i;
      let found = null, primary = null;
      const collect = (root) => {
        if (found) return;
        for (const el of root.querySelectorAll('button,[role="button"]')) {
          const t = (el.textContent || '').trim();
          const a = el.getAttribute('aria-label') || '';
          if (SEND.some(p => p.test(t) || p.test(a))) { found = el; return; }
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!primary && /artdeco-button--primary/.test(cls) && !SKIP.test(t + ' ' + a)) primary = el;
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { collect(el.shadowRoot); if (found) return; }
      };
      collect(scope);
      // Only trust the primary-button fallback when we actually located the invite dialog, so we
      // never click a stray primary button elsewhere on the page when no dialog opened.
      const target = found || (dlg ? primary : null);
      if (target) { target.click(); return true; }
      return false;
    })()`,
    returnByValue: true,
  });
  return result?.result?.value === true;
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

    // Click "Connect" via an in-page element.click() — NOT a coordinate click. In the minimized
    // automation window getBoundingClientRect()/elementFromPoint() are unreliable (0×0 layout), so
    // coordinate clicks miss (root cause of no_connect / already_or_blocked). The message flow
    // already proves in-page clicks work for LinkedIn React action buttons.
    let connected = await clickConnectInPage(tabId, slug);
    console.log("[connect] clickConnectInPage:", connected);

    if (!connected) {
      // Connect may be tucked inside the "More" menu — open it in-page, then retry.
      const openedMore = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
        expression: `(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,
        returnByValue: true,
      });
      if (openedMore?.result?.value) {
        await sleep(800);
        connected = await clickConnectInPage(tabId, slug);
        console.log("[connect] clickConnectInPage after More:", connected);
      }
    }

    if (!connected) {
      const stateRes = await send<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
        expression: PROFILE_STATE_FN_SOURCE,
        returnByValue: true,
      });
      const state = stateRes?.result?.value;
      if (state === "pending") throw withCode(new Error("invitation_already_pending"), "already_pending");
      if (state === "connected") throw withCode(new Error("already_connected"), "already_connected");

      // Follow-only profile: a creator / open-profile whose primary action is "Follow" and which
      // exposes NO Connect action (not even under "More", which we already opened above). You
      // cannot send a connection request to these, so this is an intentional SKIP, not a failure.
      const followOnly = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
        expression: `(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const hasFollow = btns.some(b => /^follow$/i.test((b.textContent||'').trim()) || /^follow\\b/i.test(b.getAttribute('aria-label')||''));
          const hasConnect = btns.some(b => /^connect$/i.test((b.textContent||'').trim()) || /\\bto connect$/i.test(b.getAttribute('aria-label')||''));
          return hasFollow && !hasConnect;
        })()`,
        returnByValue: true,
      });
      if (followOnly?.result?.value) throw withCode(new Error("follow_only"), "follow_only");

      throw withCode(new Error("connect_button_not_found"), "no_connect");
    }

    // The invite dialog ("Add a note to your invitation?") opens after a short delay. Poll for its
    // Send button and click it in-page (again, no coordinates).
    let sent = false;
    for (let i = 0; i < 6; i++) {
      await sleep(i === 0 ? 1500 : 800);
      sent = await clickSendInPage(tabId);
      if (sent) break;
    }
    console.log("[connect] clickSendInPage:", sent);

    if (!sent) {
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
