import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat, agentStep } from "./lib/api";
import { attach, detach, click, pressKey, typeText, insertTextIntoNamedCompose, clickSendButton, closeAllComposeOverlays, takeScreenshot, scrollBy, scanButtons, clickMessageButton } from "./lib/cdp";

const POLL_INTERVAL_S = 30;
const HEARTBEAT_INTERVAL_S = 60;
const VERSION = "0.2.0";

// Semaphore — only one send task runs at a time
let taskRunning = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("poll", { periodInMinutes: POLL_INTERVAL_S / 60 });
  chrome.alarms.create("hb", { periodInMinutes: HEARTBEAT_INTERVAL_S / 60 });
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

async function executeTask(task: { id: string; kind: "SEND" | "CHECK_REPLY"; payload: unknown }): Promise<unknown> {
  const payload = task.payload as { linkedinUrl?: string; conversationUrl?: string; text?: string; sinceIso?: string };

  if (task.kind === "SEND") {
    if (!payload.linkedinUrl || !payload.text) throw withCode(new Error("missing_payload"), "bad_payload");
    return await sendLinkedInMessage(payload.linkedinUrl, payload.text, payload.recipientName ?? "");
  }

  if (task.kind === "CHECK_REPLY") {
    return { replyDetected: false, replies: [] };
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
