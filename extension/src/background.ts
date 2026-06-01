import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat, agentStep } from "./lib/api";
import { attach, detach, click, pressKey, typeText, pasteFromClipboard, takeScreenshot, scrollBy, scanButtons } from "./lib/cdp";

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
    const screenshot = (err as Error & { screenshot?: string }).screenshot;
    const buttons = (err as Error & { buttons?: unknown }).buttons;
    await reportResult(task.id, {
      ok: false,
      errorCode,
      errorMessage: (err as Error).message,
      ...(screenshot || buttons ? { result: { debugScreenshot: screenshot, buttons } } : {}),
    });
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

async function sendLinkedInMessage(profileUrl: string, text: string): Promise<{ sentAt: string; conversationUrl: string; steps: number }> {
  const tab = await chrome.tabs.create({ url: profileUrl, active: true });
  if (!tab.id) throw withCode(new Error("tab_create_failed"), "tab_load");
  const tabId = tab.id;

  let attached = false;
  let caughtError: Error | null = null;

  try {
    await waitForTabLoad(tabId);
    await sleep(2500);

    await attach(tabId);
    attached = true;

    // Write message text to OS clipboard once, up front
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t: string) => navigator.clipboard.writeText(t),
      args: [text],
    });
    await sleep(200);

    const preview = text.slice(0, 80) + (text.length > 80 ? "…" : "");
    const goal = `Send this LinkedIn message to the profile shown: "${preview}". The full text is already on the OS clipboard.`;
    const history: Array<{ action: string; reasoning?: string }> = [];

    for (let step = 0; step < 15; step++) {
      const screenshot = await takeScreenshot(tabId);
      const action = await agentStep({ screenshot, goal, history });
      const reasoning = action.action === "fail" ? action.reason : action.reasoning;
      console.log(`[agent step ${step + 1}] ${action.action}`, reasoning);
      history.push({ action: action.action, reasoning });

      if (action.action === "done") {
        return { sentAt: new Date().toISOString(), conversationUrl: profileUrl, steps: step + 1 };
      }
      if (action.action === "fail") {
        throw withCode(new Error(action.reason || "agent_failed"), "agent_failed");
      }

      switch (action.action) {
        case "click":
          await click(tabId, action.x, action.y);
          break;
        case "paste":
          await pasteFromClipboard(tabId);
          break;
        case "type":
          await typeText(tabId, action.text);
          break;
        case "key":
          await pressKey(tabId, action.key, keyCodeOf(action.key));
          break;
        case "scroll":
          await scrollBy(tabId, action.dy);
          break;
        case "wait":
          await sleep(Math.min(action.ms, 2000));
          break;
      }
      await sleep(700);
    }
    throw withCode(new Error("agent_max_steps"), "agent_max_steps");
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
