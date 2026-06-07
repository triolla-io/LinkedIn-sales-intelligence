import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat, agentStep } from "./lib/api";
import { attach, detach, click, pressKey, typeText, insertTextIntoNamedCompose, clickSendButton, closeAllComposeOverlays, takeScreenshot, scrollBy, scanButtons, clickMessageButton, send } from "./lib/cdp";

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

// Semaphore — only one send task runs at a time
let taskRunning = false;

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

  let attached = false;
  let caughtError: Error | null = null;

  try {
    await waitForTabLoad(tabId);
    await sleep(2500);

    // Bring the window to front so CDP clicks land on a focused window
    const tabInfo = await chrome.tabs.get(tabId);
    if (tabInfo.windowId) await chrome.windows.update(tabInfo.windowId, { focused: true });
    await sleep(300);

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

    // Close ALL open compose overlays from previous attempts before opening a new one
    const closedCount = await closeAllComposeOverlays(tabId);
    if (closedCount > 0) { console.log("[agent] closed", closedCount, "existing compose overlay(s)"); await sleep(500); }

    // Phase 1: click Message button directly via CSS selector (reliable, no Gemini)
    const msgBtn = await clickMessageButton(tabId);
    console.log("[agent] clickMessageButton:", msgBtn);
    if (!msgBtn) throw withCode(new Error("message_button_not_found"), "not_messageable");
    // The link navigates to /messaging/compose/ — wait for page load
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
    const name = nameRaw.replace(/\\s*•\\s*(1st|2nd|3rd\\+?).*/, '').replace(/\\s*★.*/, '').trim();
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
  const tab = await chrome.tabs.create({ url: searchUrl, active: true });
  if (!tab.id) throw withCode(new Error("tab_create_failed"), "tab_load");
  const tabId = tab.id;

  let attached = false;

  try {
    await waitForTabLoad(tabId);
    await sleep(2500);

    // Bring window to front
    const tabInfo = await chrome.tabs.get(tabId);
    if (tabInfo.windowId) await chrome.windows.update(tabInfo.windowId, { focused: true });
    await sleep(300);

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
  }
}

// ---------- CONNECT: send a LinkedIn connection request ----------

async function sendConnectRequest(profileUrl: string): Promise<{ sentAt: string }> {
  const tab = await chrome.tabs.create({ url: profileUrl, active: true });
  if (!tab.id) throw withCode(new Error("tab_create_failed"), "tab_load");
  const tabId = tab.id;

  let attached = false;

  try {
    await waitForTabLoad(tabId);
    await sleep(2500);

    // Bring window to front
    const tabInfo = await chrome.tabs.get(tabId);
    if (tabInfo.windowId) await chrome.windows.update(tabInfo.windowId, { focused: true });
    await sleep(300);

    // Checkpoint detection
    const freshTab = await chrome.tabs.get(tabId);
    if (freshTab.url && freshTab.url.includes("/checkpoint")) {
      throw withCode(new Error("checkpoint"), "checkpoint");
    }

    await attach(tabId);
    attached = true;

    // Scan for Connect button — may be direct or behind a "More" dropdown
    let buttons = await scanButtons(tabId);
    let connectBtn = buttons.find((b) => /^connect$/i.test(b.text) || /^connect$/i.test(b.aria));

    if (!connectBtn) {
      // Try "More" dropdown
      const moreBtn = buttons.find((b) => /^more$/i.test(b.text) || /^more$/i.test(b.aria));
      if (moreBtn) {
        await click(tabId, moreBtn.x + Math.round(moreBtn.w / 2), moreBtn.y + Math.round(moreBtn.h / 2));
        await sleep(700);
        buttons = await scanButtons(tabId);
        connectBtn = buttons.find((b) => /connect/i.test(b.text) || /connect/i.test(b.aria));
      }
    }

    if (!connectBtn) {
      throw withCode(new Error("connect_button_not_found"), "no_connect");
    }

    // Click Connect
    await click(tabId, connectBtn.x + Math.round(connectBtn.w / 2), connectBtn.y + Math.round(connectBtn.h / 2));
    await sleep(900);

    // Find "Send without a note" (or fallback "Send") in the dialog
    const afterButtons = await scanButtons(tabId);
    const sendBtn =
      afterButtons.find((b) => /send without a note/i.test(b.text) || /send without a note/i.test(b.aria)) ||
      afterButtons.find((b) => /^send$/i.test(b.text) || /^send$/i.test(b.aria));

    if (!sendBtn) {
      throw withCode(new Error("send_dialog_not_found"), "already_or_blocked");
    }

    await click(tabId, sendBtn.x + Math.round(sendBtn.w / 2), sendBtn.y + Math.round(sendBtn.h / 2));
    await sleep(800);

    return { sentAt: new Date().toISOString() };
  } finally {
    if (attached) await detach(tabId).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
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
