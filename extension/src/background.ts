import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat } from "./lib/api";
import { attach, detach, click, typeText, pressKey, evalFindCompose } from "./lib/cdp";

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

    // Find and click Message button (try English and Hebrew labels)
    const msgBtnCoords =
      await findElement(tabId, 'button[aria-label^="Message"]', 3_000) ??
      await findElement(tabId, 'button[aria-label^="הודעה"]', 3_000) ??
      await findElement(tabId, 'button[aria-label*="essage"]', 3_000) ??
      await findElement(tabId, 'a[href*="/messaging/compose"]', 3_000);
    if (!msgBtnCoords) throw withCode(new Error("message_button_not_found"), "not_messageable");

    await click(tabId, msgBtnCoords.x, msgBtnCoords.y);
    await sleep(4000); // Wait for chat overlay to fully mount

    // Find compose editor via CDP Runtime.evaluate (sees all frames, runs in page context)
    let composeCoords: { x: number; y: number } | null = null;
    const deadline = Date.now() + 10_000;
    while (!composeCoords && Date.now() < deadline) {
      composeCoords = await evalFindCompose(tabId);
      if (!composeCoords) await sleep(500);
    }
    if (!composeCoords) throw withCode(new Error("compose_not_found"), "selector_missing");

    await click(tabId, composeCoords.x, composeCoords.y);
    await sleep(400);

    await typeText(tabId, text);
    await sleep(800);

    await pressKey(tabId, "Enter", 13);
    await sleep(2500);

    return { sentAt: new Date().toISOString(), conversationUrl: profileUrl };
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
