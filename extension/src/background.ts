import { getToken, isPaused } from "./lib/storage";
import { pollTask, reportResult, heartbeat } from "./lib/api";

const POLL_INTERVAL_S = 30;
const HEARTBEAT_INTERVAL_S = 60;
const VERSION = "0.1.0";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("poll", { periodInMinutes: POLL_INTERVAL_S / 60 });
  chrome.alarms.create("hb", { periodInMinutes: HEARTBEAT_INTERVAL_S / 60 });
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (!(await getToken())) return;
  if (await isPaused()) return;
  if (a.name === "hb") {
    await heartbeat(VERSION);
    return;
  }
  if (a.name === "poll") {
    await runOneCycle();
  }
});

async function runOneCycle() {
  let task;
  try {
    task = await pollTask();
  } catch (e) {
    console.warn("poll error", e);
    return;
  }
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
  const url = payload.linkedinUrl ?? payload.conversationUrl;
  if (!url) throw withCode(new Error("missing_url"), "bad_payload");

  // active: true is required — execCommand needs user-activated document to insert text
  const tab = await chrome.tabs.create({ url, active: true });
  if (!tab.id) throw withCode(new Error("tab_create_failed"), "tab_load");

  try {
    return await waitForTabAndDispatch(tab.id, task.kind, payload);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function waitForTabAndDispatch(tabId: number, kind: "SEND" | "CHECK_REPLY", payload: unknown): Promise<unknown> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(withCode(new Error("tab_load_timeout"), "tab_load"));
    }, 30_000);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Give LinkedIn's React time to mount before injecting
        setTimeout(resolve, 1500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => reject(withCode(new Error("content_script_timeout"), "timeout")), 90_000);
    chrome.tabs.sendMessage(tabId, { kind, payload }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        return reject(withCode(new Error(chrome.runtime.lastError.message ?? "lastError"), "tab_load"));
      }
      if (!response?.ok) {
        return reject(withCode(new Error(response?.errorMessage ?? "unknown"), response?.errorCode ?? "unknown"));
      }
      resolve(response.result);
    });
  });
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
