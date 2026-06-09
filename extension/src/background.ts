import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat, agentStep } from "./lib/api";
import { attach, detach, click, pressKey, typeText, insertTextIntoNamedCompose, clickSendButton, closeAllComposeOverlays, takeScreenshot, scrollBy, scanButtons, findMessageButton, send, getAutomationWindow, openTabInAutomationWindow, closeStaleAutomationWindow } from "./lib/cdp";
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
const VERSION = "0.2.0";

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
    await reportResult(task.id, {
      ok: false,
      errorCode,
      errorMessage: (err as Error).message,
      ...(screenshot || buttons ? { result: { debugScreenshot: screenshot, buttons } } : {}),
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

async function sendLinkedInMessage(profileUrl: string, text: string, recipientName = ""): Promise<{ sentAt: string; conversationUrl: string; steps: number }> {
  const tab = await chrome.tabs.create({ url: profileUrl, active: true });
  if (!tab.id) throw withCode(new Error("tab_create_failed"), "tab_load");
  const tabId = tab.id;
  await trackActiveTab(tabId);

  let attached = false;
  let caughtError: Error | null = null;

  try {
    await waitForTabLoad(tabId);
    await sleep(2500);

    // Bring the window to front so CDP clicks land on a focused window
    const tabInfo = await chrome.tabs.get(tabId);
    if (tabInfo.windowId) await chrome.windows.update(tabInfo.windowId, { focused: true });
    await sleep(300);

    const preTab = await chrome.tabs.get(tabId);
    if (preTab.url && preTab.url.includes("/checkpoint")) {
      throw withCode(new Error("checkpoint"), "checkpoint");
    }

    await attach(tabId);
    attached = true;

    // Get device pixel ratio so we can normalize screenshot coords to CSS coords
    const dprResult = await (await import("./lib/cdp")).send<{ result: { value: number } }>(
      tabId, "Runtime.evaluate", { expression: "window.devicePixelRatio", returnByValue: true }
    );
    const dpr = dprResult?.result?.value ?? 1;
    console.log("[agent] devicePixelRatio:", dpr);

    // Write message text to OS clipboard once, up front
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t: string) => navigator.clipboard.writeText(t),
      args: [text],
    });
    await sleep(200);

    // Close any compose overlays left from previous attempts (returns void).
    await closeAllComposeOverlays(tabId);
    await sleep(500);

    // Phase 1: find the Message button and click it with a trusted CDP click.
    let msgBtn = await findMessageButton(tabId);
    if (!msgBtn) {
      // Fallback: open the "More" overflow menu, then look again.
      const buttons = await scanButtons(tabId);
      const more = buttons.find((b) => /^more$/i.test(b.text) || /^more$/i.test(b.aria) || /^עוד$/.test(b.text));
      if (more) {
        await click(tabId, more.x + Math.round(more.w / 2), more.y + Math.round(more.h / 2));
        await sleep(700);
        msgBtn = await findMessageButton(tabId);
      }
    }
    console.log("[agent] findMessageButton:", msgBtn);
    if (!msgBtn) throw withCode(new Error("message_button_not_found"), "not_messageable");
    await click(tabId, msgBtn.x, msgBtn.y);
    // The action opens compose (overlay) or navigates to /messaging/compose/.
    await waitForTabLoad(tabId).catch(() => {}); // may or may not navigate
    await sleep(2500);

    // Phase 2: insert text with retry
    let inserted = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      inserted = await insertTextIntoNamedCompose(tabId, text, recipientName);
      console.log(`[agent] insertTextIntoCompose attempt ${attempt + 1}:`, inserted);
      if (inserted) break;
      await sleep(600);
    }
    if (!inserted) throw withCode(new Error("compose_insert_failed"), "compose_insert_failed");
    await sleep(800); // let React process the inserted text and enable Send

    // Phase 3: click Send button directly via shadow DOM
    const sent = await clickSendButton(tabId);
    console.log("[agent] clickSendButton:", sent);
    if (!sent) throw withCode(new Error("send_button_not_found"), "send_button_not_found");
    await sleep(1500);

    // Phase 4: close the compose overlay so it doesn't interfere with the next send
    await closeAllComposeOverlays(tabId).catch(() => {});
    await sleep(300);

    return { sentAt: new Date().toISOString(), conversationUrl: profileUrl, steps: 3 };
  } catch (err) {
    caughtError = err as Error;
    const failedTab = await chrome.tabs.get(tabId).catch(() => null);
    if (failedTab?.url) caughtError.message = `${caughtError.message} (url=${failedTab.url})`;
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

function keyCodeOf(k: "Enter" | "Escape" | "Tab"): number {
  return k === "Enter" ? 13 : k === "Escape" ? 27 : k === "Tab" ? 9 : 0;
}

// ---------- SEARCH: scrape LinkedIn search results page ----------

const SCRAPE_FN_SOURCE = `(() => {
  const section = document.querySelector('section[aria-label="Primary content"]');
  if (!section) return { candidates: [], hasNextPage: false };
  const allLinks = Array.from(section.querySelectorAll('a[href*="/in/"]'));
  const seen = new Set();
  const out = [];
  for (const link of allLinks) {
    const profileUrl = link.href.split('?')[0];
    if (seen.has(profileUrl) || !profileUrl.match(/linkedin\\.com\\/in\\/[^\\/]+\\/?$/)) continue;
    seen.add(profileUrl);
    // derive a stable urn from the profile slug
    const slug = profileUrl.replace(/\\/$/, '').split('/in/')[1] || '';
    const urn = 'urn:li:member:' + slug;
    // raw text of the card subtree (2-3 levels up from the link)
    const container = link.parentElement?.parentElement?.parentElement || link.parentElement;
    const raw = (container ? container.innerText : '').replace(/\\s+/g, ' ').trim();
    // name: first part of link text before " • "
    const nameRaw = link.innerText.trim().split('\\n')[0];
    // Strip: connection degree (" • 2nd"), favorite stars, and the inline "+N" shared-connection
    // badge LinkedIn glues to names in search cards (e.g. "+1 Yuval Bar Or"). Names never contain "+digits".
    const name = nameRaw.replace(/\\s*•\\s*(1st|2nd|3rd\\+?).*/, '').replace(/\\s*★.*/, '').replace(/\\+\\d+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!name || name.length < 2) continue;
    // degree
    const degM = raw.match(/(1st|2nd|3rd\\+?)/);
    const degree = degM ? (degM[1].startsWith('3') ? '3rd' : degM[1]) : null;
    // title + company: look for "X at Y" or "X" pattern in raw text after name
    const afterName = raw.substring(raw.indexOf(name) + name.length).replace(/^[^a-zA-Zא-ת]+/, '');
    const atMatch = afterName.match(/^([^|•\\n]+?) at ([^|•\\n]+)/);
    let title = null, company = null, location = null;
    if (atMatch) {
      title = atMatch[1].trim();
      const rest = atMatch[2];
      // location is often after company — split on newline or " | "
      const locM = rest.split(/\\||\\n/);
      company = locM[0].trim();
      location = locM[1] ? locM[1].trim() : null;
    } else {
      const lines = afterName.split(/\\n|\\|/).map(s => s.trim()).filter(Boolean);
      title = lines[0] || null;
      location = lines[1] || null;
    }
    out.push({ urn, profileUrl, name, title, company, location, degree });
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
      const patterns = [/send without/i, /שלח ללא/i, /^send$/i, /^שלח$/i];
      let found = null;
      const collect = (root) => {
        if (found) return;
        for (const el of root.querySelectorAll('button,[role="button"]')) {
          const t = (el.textContent || '').trim();
          const a = el.getAttribute('aria-label') || '';
          if (patterns.some(p => p.test(t) || p.test(a))) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              found = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
              return;
            }
          }
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { collect(el.shadowRoot); if (found) return; }
      };
      collect(scope);
      return found;
    })()`,
    returnByValue: true,
  });
  return (result?.result?.value as { x: number; y: number; w: number; h: number } | null) ?? null;
}

async function sendConnectRequest(profileUrl: string): Promise<{ sentAt: string }> {
  const tabId = await openTabInAutomationWindow(profileUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_load");
  });
  await trackActiveTab(tabId);

  let attached = false;

  try {
    await waitForTabLoad(tabId);
    await sleep(4000);
    // Do NOT focus the window — runs in the background automation window.

    // Checkpoint detection
    const freshTab = await chrome.tabs.get(tabId);
    if (freshTab.url && freshTab.url.includes("/checkpoint")) {
      throw withCode(new Error("checkpoint"), "checkpoint");
    }

    await attach(tabId);
    attached = true;

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
      throw withCode(new Error("send_dialog_not_found"), "already_or_blocked");
    }

    await click(tabId, sendCoords.x + Math.round(sendCoords.w / 2), sendCoords.y + Math.round(sendCoords.h / 2));
    await sleep(800);

    return { sentAt: new Date().toISOString() };
  } finally {
    if (attached) await detach(tabId).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
    await clearActiveTab();
  }
}

async function waitForTabLoad(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(withCode(new Error("tab_load_timeout"), "tab_load"));
    }, 30_000);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
