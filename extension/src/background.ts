import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat } from "./lib/api";
import { attach, detach, click, pressKey, typeText, getComposeCoords } from "./lib/cdp";

const POLL_INTERVAL_S = 30;
const HEARTBEAT_INTERVAL_S = 60;
const VERSION = "0.2.0";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("poll", { periodInMinutes: POLL_INTERVAL_S / 60 });
  chrome.alarms.create("hb", { periodInMinutes: HEARTBEAT_INTERVAL_S / 60 });
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (!(await getToken())) return;
  if (await isPaused()) return;
  if (a.name === "hb") { await heartbeat(VERSION); return; }
  if (a.name === "poll") { await runOneCycle(); }
});

async function runOneCycle() {
  let task;
  try { task = await pollTask(); } catch (e) { console.warn("poll error", e); return; }
  if (!task) return;

  try {
    const result = await executeTask(task);
    await reportResult(task.id, { ok: true, result });
  } catch (err) {
    const errorCode = (err as Error & { code?: string }).code ?? "unknown";
    await reportResult(task.id, { ok: false, errorCode, errorMessage: (err as Error).message });
  }
}

async function executeTask(task: { id: string; kind: "SEND" | "CHECK_REPLY"; payload: unknown }): Promise<unknown> {
  const payload = task.payload as { linkedinUrl?: string; conversationUrl?: string; text?: string; sinceIso?: string };

  if (task.kind === "SEND") {
    if (!payload.linkedinUrl || !payload.text) throw withCode(new Error("missing_payload"), "bad_payload");
    return await sendLinkedInMessage(payload.linkedinUrl, payload.text);
  }

  if (task.kind === "CHECK_REPLY") {
    return { replyDetected: false, replies: [] };
  }

  throw withCode(new Error("unknown_kind"), "bad_payload");
}

async function sendLinkedInMessage(profileUrl: string, text: string): Promise<{ sentAt: string; conversationUrl: string }> {
  const tab = await chrome.tabs.create({ url: profileUrl, active: true });
  if (!tab.id) throw withCode(new Error("tab_create_failed"), "tab_load");
  const tabId = tab.id;

  let attached = false;
  try {
    await waitForTabLoad(tabId);
    await sleep(2500);

    await attach(tabId);
    attached = true;

    // Dismiss any modal/popup that LinkedIn may show (Premium upsell, etc.)
    await dismissModal(tabId);
    await sleep(500);

    // Find and click Message button (try English and Hebrew labels)
    const msgBtnCoords =
      await findElement(tabId, 'button[aria-label^="Message"]', 3_000) ??
      await findElement(tabId, 'button[aria-label^="הודעה"]', 3_000) ??
      await findElement(tabId, 'button[aria-label*="essage"]', 3_000) ??
      await findElement(tabId, 'a[href*="/messaging/compose"]', 3_000);
    if (!msgBtnCoords) throw withCode(new Error("message_button_not_found"), "not_messageable");

    await click(tabId, msgBtnCoords.x, msgBtnCoords.y);
    await sleep(4000); // Wait for chat overlay to fully mount

    // Step 1: Get compose + send button coordinates via Runtime.evaluate
    let coords: { ok: boolean; composeX?: number; composeY?: number; sendX?: number; sendY?: number } = { ok: false };
    const deadline = Date.now() + 10_000;
    while (!coords.ok && Date.now() < deadline) {
      coords = await getComposeCoords(tabId);
      if (!coords.ok) await sleep(500);
    }
    if (!coords.ok) throw withCode(new Error("compose_not_found"), "selector_missing");

    // Step 2: CDP click on compose area — gives trusted focus + user activation
    await click(tabId, coords.composeX!, coords.composeY!);
    await sleep(300);

    // Step 3: Type via CDP Input.insertText (now has proper focus)
    await typeText(tabId, text);
    await sleep(1000);

    // Step 4: CDP click Send button (trusted)
    if (coords.sendX && coords.sendY) {
      await click(tabId, coords.sendX, coords.sendY);
    } else {
      await pressKey(tabId, "Enter", 13);
    }
    await sleep(2500);

    return { sentAt: new Date().toISOString(), conversationUrl: profileUrl };
  } finally {
    if (attached) await detach(tabId).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function dismissModal(tabId: number): Promise<void> {
  // Dismiss any modal/dialog LinkedIn may show (Premium upsell, etc.)
  const result = await sendMessageToTab(tabId, {
    kind: "FIND_ELEMENTS",
    selectors: [
      'button[aria-label="Dismiss"]',
      'button[aria-label="Close"]',
      'button[data-tracking-control-name="premium_upsell_modal_close"]',
      '.modal__dismiss',
      '[data-test-modal-close-btn]',
      'button.artdeco-modal__dismiss',
    ],
  });
  for (const [sel, info] of Object.entries(result?.result ?? {})) {
    if (info?.found && info.x && info.y) {
      await click(tabId, info.x, info.y);
      return;
    }
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

async function findElement(
  tabId: number,
  selector: string,
  timeoutMs: number
): Promise<{ x: number; y: number } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await sendMessageToTab(tabId, { kind: "FIND_ELEMENTS", selectors: [selector] });
    const info = response?.result?.[selector];
    if (info?.found) return { x: info.x!, y: info.y! };
    await sleep(500);
  }
  return null;
}

async function sendMessageToTab(
  tabId: number,
  message: object
): Promise<{ ok: boolean; result?: Record<string, { found: boolean; x?: number; y?: number }> }> {
  return await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      void chrome.runtime.lastError;
      resolve(response ?? { ok: false });
    });
  });
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
