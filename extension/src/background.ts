import { getToken, isPaused, setLastFailure } from "./lib/storage";
import { pollTask, reportResult, heartbeat } from "./lib/api";
import {
  closeAutomationTab,
  closeStaleAutomationWindow,
  discardAutomationWindow,
  navigateTab,
  openTabInAutomationWindow,
  pageCall,
  sleep,
  takeScreenshot,
  waitForTabLoad,
} from "./lib/page";
import { withTimeout } from "./lib/with-timeout";
import {
  companySearchUrl,
  companySlugFromUrl,
  pickBestCompany,
} from "./lib/resolve-company";
import type { ScrapeResult } from "./lib/scrape-search";
import { scrapeProfile } from "./lib/scrape-profile";

const POLL_INTERVAL_S = 30;
const HEARTBEAT_INTERVAL_S = 60;
// Read from the manifest rather than restated here. This string is what the heartbeat
// reports, so it is how prod tells which build a customer is actually running — and a
// hand-maintained copy had already drifted two versions behind (0.6.7 vs manifest 0.6.9),
// which would have made the About/Experience rollout unverifiable from the server side.
const VERSION = chrome.runtime.getManifest().version;

// Hard ceiling for a single task. Real tasks finish in seconds; the slowest legitimate
// path (compose poll 15s + navigation waits 30s + sleeps) stays well under a minute.
// Without this ceiling a task that never settles leaves `taskRunning` true forever, so
// every later poll is skipped and the whole queue dies while the heartbeat still reports
// "connected". A native "Leave site?" dialog blocking chrome.tabs.remove used to be the
// known cause; drafts are now cleared before every navigation/close so it should not
// recur — the ceiling stays as the backstop.
const TASK_TIMEOUT_MS = 3 * 60_000;

// In-memory semaphore (fast, race-free in single-threaded JS).
let taskRunning = false;

/**
 * Breadcrumb trail for the task currently running.
 *
 * Prod is the only place these flows meet real LinkedIn, and the service-worker console
 * is gone the moment the worker sleeps — so every step records itself here and the trail
 * ships with the failure report. A failed task then says WHERE it broke in the dashboard,
 * with no console archaeology. Safe as module state: the semaphore above guarantees one
 * task at a time.
 */
let trail: Array<{ step: string; ms: number; data?: unknown }> = [];
let trailStart = 0;

function trace(step: string, data?: unknown): void {
  trail.push({ step, ms: Date.now() - trailStart, ...(data === undefined ? {} : { data }) });
  console.log(`[agent] ${step}`, data ?? "");
}

/**
 * One-line trail summary appended to `errorMessage`.
 *
 * The structured trail also goes into `result`, but the dashboard already renders
 * errorMessage — so putting the summary there makes a failure diagnosable on a deployment
 * that has not shipped any new UI.
 */
function formatTrail(): string {
  const parts = trail.map(({ step, ms, data }) => {
    const t = `${(ms / 1000).toFixed(1)}s`;
    if (data === undefined) return `${step}@${t}`;
    let shown: string;
    try {
      shown = typeof data === "object" ? JSON.stringify(data) : String(data);
    } catch {
      shown = "?";
    }
    return `${step}=${shown.slice(0, 120)}@${t}`;
  });
  return parts.join(" · ").slice(0, 700);
}

// Track the tab opened by the current task in local storage so orphaned tabs
// can be closed if the service worker is restarted mid-task.
async function trackActiveTab(tabId: number) {
  await chrome.storage.local.set({ swActiveTabId: tabId });
}
async function clearActiveTab() {
  await chrome.storage.local.remove("swActiveTabId");
}

// Watchdog teardown for a task that timed out mid-flight. Every step is time-bounded: the
// tab may hold a native beforeunload dialog, which blocks chrome.tabs.remove itself — so
// cleanup must never be able to wedge the loop a second time. closeAutomationTab clears the
// draft first (that is what disarms beforeunload); if the tab still refuses to close, the
// whole automation window goes.
async function forceCloseTrackedTab(): Promise<void> {
  const { swActiveTabId } = await chrome.storage.local.get("swActiveTabId");
  if (typeof swActiveTabId !== "number") return;
  try {
    await withTimeout(closeAutomationTab(swActiveTabId), 8_000, "remove_timeout");
    console.log("[watchdog] closed timed-out tab", swActiveTabId);
  } catch (e) {
    console.warn("[watchdog] tab close failed, discarding automation window", e);
    await withTimeout(discardAutomationWindow(), 3_000, "discard_timeout").catch(() => {});
  } finally {
    await clearActiveTab();
  }
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
  trail = [];
  trailStart = Date.now();
  trace("task.start", { kind: task.kind });
  try {
    const result = await withTimeout(executeTask(task), TASK_TIMEOUT_MS, "task_timeout");
    await reportResult(task.id, { ok: true, result });
  } catch (err) {
    const errorCode = (err as Error & { code?: string }).code ?? "unknown";
    // A timed-out flow is still mid-run: its own `finally` never executed, so the tab it
    // opened is still there (possibly holding the dialog that caused the hang). Tear it
    // down here, or the next task inherits a foreign tab.
    if (errorCode === "task_timeout") await forceCloseTrackedTab();
    const screenshot = (err as Error & { screenshot?: string }).screenshot;
    const buttons = (err as Error & { buttons?: unknown }).buttons;
    const diag = (err as Error & { diag?: unknown }).diag;
    const errorMessage = `${(err as Error).message} | trail: ${formatTrail()}`;
    // Keep it locally too: the popup shows it with a copy button, which is the only way to
    // read a failed send's reason without the service-worker console.
    await setLastFailure({
      at: new Date().toISOString(),
      kind: task.kind,
      errorCode,
      errorMessage,
    }).catch(() => {});
    await reportResult(task.id, {
      ok: false,
      errorCode,
      errorMessage,
      result: { debugScreenshot: screenshot, buttons, diag, trail },
    });
  } finally {
    taskRunning = false;
  }
  return true;
}

async function executeTask(task: { id: string; kind: "SEND" | "CHECK_REPLY" | "SEARCH" | "CONNECT" | "RESOLVE_COMPANY" | "SCRAPE_PROFILE" | "PREPARE_MESSAGE" | "SCRAPE_POSTS" | "PREPARE_COMMENT"; payload: unknown }): Promise<unknown> {
  const payload = task.payload as {
    linkedinUrl?: string;
    conversationUrl?: string;
    text?: string;
    sinceIso?: string;
    searchUrl?: string;
    page?: number;
    profileUrl?: string;
    recipientName?: string;
    name?: string;
    activityUrl?: string;
    postUrl?: string;
  };

  if (task.kind === "SEND") {
    if (!payload.linkedinUrl || !payload.text) throw withCode(new Error("missing_payload"), "bad_payload");
    return await sendLinkedInMessage(payload.linkedinUrl, payload.text);
  }

  if (task.kind === "PREPARE_MESSAGE") {
    if (!payload.linkedinUrl || !payload.text) throw withCode(new Error("missing_payload"), "bad_payload");
    return await prepareLinkedInMessage(payload.linkedinUrl, payload.text);
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

  if (task.kind === "RESOLVE_COMPANY") {
    if (!payload.linkedinUrl && !payload.name)
      throw withCode(new Error("missing_payload"), "bad_payload");
    return await resolveCompany(
      payload.linkedinUrl ?? null,
      payload.name ?? null,
    );
  }

  if (task.kind === "SCRAPE_PROFILE") {
    if (!payload.linkedinUrl) throw withCode(new Error("missing_payload"), "bad_payload");
    return await scrapeProfile(payload.linkedinUrl);
  }

  if (task.kind === "SCRAPE_POSTS") {
    if (!payload.activityUrl) throw withCode(new Error("missing_payload"), "bad_payload");
    return await scrapeRecentPosts(payload.activityUrl);
  }

  if (task.kind === "PREPARE_COMMENT") {
    if (!payload.postUrl || !payload.text) throw withCode(new Error("missing_payload"), "bad_payload");
    return await prepareLinkedInComment(payload.postUrl, payload.text);
  }

  throw withCode(new Error("unknown_kind"), "unsupported_kind");
}

// Collect environment hints to diagnose tab-hijack / extension-conflict failures
// remotely (the result is persisted to the DB). Captures the tab's actual state and the
// list of installed extensions — when another extension redirects our LinkedIn tab to its
// own chrome-extension:// page, our page calls come back "unreachable", and this reveals
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
      hints.extensions = all.flatMap((x) =>
        x.type === "extension" ? [{ id: x.id, name: x.name, enabled: x.enabled }] : [],
      );
    } else {
      hints.extensions = "management_api_unavailable";
    }
  } catch (e) {
    hints.managementError = String((e as Error)?.message ?? e);
  }
  return hints;
}

/** Attach the standard failure diagnostics (env hints + screenshot + buttons) to `err`. */
async function decorateFailure(err: Error, tabId: number, withVisuals: boolean): Promise<Error> {
  const failedTab = await chrome.tabs.get(tabId).catch(() => null);
  if (failedTab?.url) err.message = `${err.message} (url=${failedTab.url})`;
  (err as Error & { diag?: unknown }).diag = await gatherEnvHints(tabId).catch(() => ({ diagError: true }));
  if (withVisuals) {
    // Independent captures: a screenshot failure used to take the button scan down with it
    // (both were awaited in one Promise.all), which is why a real failure came back with
    // neither. captureVisibleTab is the fragile one — it needs the tab to be the visible
    // tab of its window.
    const [shot, scan] = await Promise.allSettled([
      takeScreenshot(tabId),
      pageCall(tabId, { kind: "SCAN_BUTTONS" }, { retries: 2 }),
    ]);
    if (shot.status === "fulfilled") (err as Error & { screenshot?: string }).screenshot = shot.value;
    if (scan.status === "fulfilled") (err as Error & { buttons?: unknown }).buttons = scan.value;
  }
  return err;
}

// ---------- SEND / PREPARE_MESSAGE ----------

async function sendLinkedInMessage(profileUrl: string, text: string): Promise<{ sentAt: string; conversationUrl: string; steps: number }> {
  // Straight to the profile — the old "open about:blank, attach, then navigate" dance only
  // existed to dodge chrome.debugger's attach-time security check (which refused any tab
  // already hosting another extension's frames, e.g. HubSpot Sales / Datanyze on LinkedIn).
  // The content script has no such restriction.
  const tabId = await openTabInAutomationWindow(profileUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_create_failed");
  });
  await trackActiveTab(tabId);

  try {
    await navigateToComposeAndType(tabId, profileUrl, text);

    // Phase 3: click Send (enabled by the typing above) and confirm LinkedIn took it.
    const { clicked, emptied } = await pageCall(tabId, { kind: "CLICK_SEND" });
    trace("send.clicked", { clicked, emptied });
    if (!clicked) throw withCode(new Error("send_button_not_found"), "send_button_not_found");
    // The compose box always empties on a successful send. If it still holds the draft, the
    // click did not go through — reporting success here is what would create a phantom
    // "sent" row with no message on LinkedIn.
    if (!emptied) throw withCode(new Error("compose_box_not_cleared_after_send"), "send_not_confirmed");

    return { sentAt: new Date().toISOString(), conversationUrl: profileUrl, steps: 3 };
  } catch (err) {
    throw await decorateFailure(err as Error, tabId, true);
  } finally {
    // closeAutomationTab clears the draft first, so the beforeunload handler LinkedIn arms
    // for an unsent draft can't surface a native "Leave site?" dialog to the user.
    await closeAutomationTab(tabId);
    await clearActiveTab();
  }
}

// PREPARE_MESSAGE: identical compose flow to SEND, but it STOPS before clicking Send.
// The typed draft is handed to the user in a focused tab — they review, hit Send
// themselves, and then confirm in the dashboard (prepare-not-send review flow).
async function prepareLinkedInMessage(profileUrl: string, text: string): Promise<{ preparedAt: string; conversationUrl: string }> {
  const tabId = await openTabInAutomationWindow(profileUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_create_failed");
  });
  await trackActiveTab(tabId);
  let prepared = false;

  try {
    await navigateToComposeAndType(tabId, profileUrl, text);

    // Hand the tab to the user: move it OUT of the automation window, which later tasks
    // reuse (and whose tabs they close).
    await moveTabToUserWindow(tabId);
    prepared = true;

    return { preparedAt: new Date().toISOString(), conversationUrl: profileUrl };
  } catch (err) {
    throw await decorateFailure(err as Error, tabId, true);
  } finally {
    // A prepared tab belongs to the user now — only tear it down on failure.
    if (!prepared) await closeAutomationTab(tabId);
    await clearActiveTab();
  }
}

/**
 * Read the contact's compose URL, touching the page as little as possible.
 *
 * Order matters. We used to sweep Escape and click a "dismiss" button BEFORE looking for
 * the Message button; a real failure came back with the tab sitting on
 * /search/results/all/?origin=GLOBAL_SEARCH_HEADER (an empty global search) while the tab
 * title still read the contact's name — i.e. our own housekeeping click moved the tab off
 * the profile. So: look first, clean up only if the button is missing, and if the tab has
 * drifted off the profile entirely, go back and look once more.
 */
async function readComposeUrl(tabId: number, profileUrl: string): Promise<string | null> {
  let composeUrl = await pageCall(tabId, { kind: "COMPOSE_URL" });
  trace("compose.url", composeUrl);
  if (composeUrl) return composeUrl;

  // Something is covering the page (LinkedIn's "upgrade to Premium" interstitial and
  // friends occlude the top card). Clear it, then look again.
  await pageCall(tabId, { kind: "CLOSE_OVERLAYS" });
  const dismissed = await pageCall(tabId, { kind: "CLICK_MODAL_CLOSE" });
  trace("modal.dismissed", dismissed);
  await sleep(500);
  composeUrl = await pageCall(tabId, { kind: "COMPOSE_URL" });
  trace("compose.url.retry", composeUrl);
  if (composeUrl) return composeUrl;

  // Still nothing — check we are even on the profile any more before reporting the contact
  // as unmessageable.
  const current = (await chrome.tabs.get(tabId)).url ?? "";
  const profilePath = profileUrl.split("?")[0].replace(/\/$/, "");
  if (!current.startsWith(profilePath)) {
    trace("profile.drifted", current.slice(0, 120));
    await navigateTab(tabId, profileUrl);
    await waitForTabLoad(tabId);
    await sleep(2500);
    composeUrl = await pageCall(tabId, { kind: "COMPOSE_URL" });
    trace("compose.url.afterRenav", composeUrl);
  }
  return composeUrl;
}

// Shared core of SEND / PREPARE_MESSAGE: the tab is already on the contact's profile;
// drive it to /messaging/compose/ and type the message. Throws coded errors; never sends.
async function navigateToComposeAndType(tabId: number, profileUrl: string, text: string): Promise<void> {
  await waitForTabLoad(tabId);
  trace("profile.loaded", { url: (await chrome.tabs.get(tabId)).url?.slice(0, 120) });
  await sleep(2500);

  await throwIfCheckpoint(tabId);

  // Phase 1: extract the compose URL from the Message button's href, then navigate
  // directly to /messaging/compose/. This is more reliable than clicking the button
  // and waiting for an overlay — the full messaging page always renders a proper
  // contenteditable that enables React-driven Send, whereas the overlay's Send button
  // can stay disabled. readComposeUrl touches the page as little as possible; see there.
  const composeUrl = await readComposeUrl(tabId, profileUrl);
  if (!composeUrl) throw withCode(new Error("message_button_not_found"), "not_messageable");

  await navigateTab(tabId, composeUrl);
  await waitForTabLoad(tabId);

  // The Message-button navigation reuses the already-"complete" profile tab, so
  // waitForTabLoad's fast path can return before the compose page has even begun
  // loading. A fixed sleep then races the SPA render: if it loses, the typing runs
  // against the profile (no compose box) and fails with compose_insert_failed — the
  // captured url= in those failures was the profile, not /messaging/compose/.
  // Poll until LinkedIn's compose box actually exists before typing.
  let navDiag = await pageCall(tabId, { kind: "COMPOSE_DIAG" });
  const composeDeadline = Date.now() + 15_000;
  while (Date.now() < composeDeadline && navDiag.msgForm === 0 && navDiag.anyEditable === 0) {
    await sleep(500);
    navDiag = await pageCall(tabId, { kind: "COMPOSE_DIAG" });
  }
  trace("compose.diag", navDiag);

  // Phase 2: type the message. execCommand("insertText") drives the browser's own editing
  // pipeline, so React's onChange fires and the Send button enables; the page reads the box
  // back, so `ok` means the text is really in there.
  const typed = await pageCall(tabId, { kind: "TYPE_INTO_COMPOSE", text });
  trace("compose.typed", typed);
  if (!typed.ok) {
    throw withCode(
      new Error(`compose_insert_failed diag=${JSON.stringify(navDiag)}`),
      "compose_insert_failed",
    );
  }
  await sleep(600);
}

// Move a prepared tab out of the (shared) automation window into the user's own browser
// window and focus it. Falls back to popping the tab into a fresh normal window when no
// other window exists.
async function moveTabToUserWindow(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] }).catch(() => [] as chrome.windows.Window[]);
  const candidates = wins.filter((w) => w.id !== undefined && w.id !== tab.windowId);
  const target = candidates.find((w) => w.state !== "minimized") ?? candidates[0];
  if (target?.id !== undefined) {
    await chrome.tabs.move(tabId, { windowId: target.id, index: -1 });
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(target.id, {
      focused: true,
      ...(target.state === "minimized" ? { state: "normal" as const } : {}),
    });
  } else {
    await chrome.windows.create({ tabId, focused: true });
  }
}

// ---------- SCRAPE_POSTS ----------

const POSTS_PER_SCRAPE = 10;
const POSTS_SCROLL_ROUNDS = 6;

// Mirrors scrapeSearch's shape (open in the automation window, track for the timeout
// watchdog, scroll-and-rescrape loop, always close). `activityUrl` is the contact's
// /recent-activity/all/ page, not a single post — scrolling is what surfaces more than
// the first page-load's worth of posts.
async function scrapeRecentPosts(activityUrl: string): Promise<{
  posts: Array<{ urn: string; text: string; postedAgoText: string | null }>;
}> {
  const tabId = await openTabInAutomationWindow(activityUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_load");
  });
  await trackActiveTab(tabId);

  try {
    await waitForTabLoad(tabId);
    await sleep(2000);
    await throwIfCheckpoint(tabId);

    let posts: Array<{ urn: string; text: string; postedAgoText: string | null }> = [];
    for (let i = 0; i < POSTS_SCROLL_ROUNDS; i++) {
      const r = await pageCall(tabId, { kind: "READ_RECENT_POSTS", limit: POSTS_PER_SCRAPE });
      posts = r.posts;
      trace("scrape_posts.round", { round: i, count: posts.length });
      if (posts.length >= POSTS_PER_SCRAPE) break;
      await pageCall(tabId, { kind: "SCROLL_BY", dy: 1500 });
      await sleep(1200);
    }

    return { posts };
  } finally {
    await closeAutomationTab(tabId);
    await clearActiveTab();
  }
}

// ---------- PREPARE_COMMENT ----------

// How long to keep polling the pure COMMENT_DIAG after the one-shot reveal click, waiting
// for LinkedIn's Quill editor to mount.
const COMMENT_DIAG_POLL_ROUNDS = 20;
const COMMENT_DIAG_POLL_DELAY_MS = 500;

// PREPARE_COMMENT: same prepare-not-send contract as PREPARE_MESSAGE — types into
// LinkedIn's own comment box on the post and STOPS. The user reviews the typed draft and
// presses LinkedIn's own submit button themselves; nothing in this flow ever clicks it.
//
// `postUrl` is always the single-post permalink
// (https://www.linkedin.com/feed/update/urn:li:activity:<id>/), never a feed — the
// content-script finders (findEditor / findCommentButton) take the FIRST matching editor
// on the page, which is only guaranteed to be the intended post on a permalink page.
//
// COMMENT_DIAG is a pure read (clicks nothing) so it is safe to poll repeatedly; the
// reveal click is a separate, single-shot action, called at most once. This mirrors
// prepareLinkedInMessage's poll-diag-then-act pattern while avoiding the up-to-30-clicks
// bug the brief's single-call version had.
async function prepareLinkedInComment(postUrl: string, text: string): Promise<{ preparedAt: string }> {
  const tabId = await openTabInAutomationWindow(postUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_create_failed");
  });
  await trackActiveTab(tabId);
  let prepared = false;

  try {
    await waitForTabLoad(tabId);
    trace("post.loaded", { url: (await chrome.tabs.get(tabId)).url?.slice(0, 120) });
    await sleep(1500);

    await throwIfCheckpoint(tabId);

    let diag = await pageCall(tabId, { kind: "COMMENT_DIAG" });
    trace("comment.diag", diag);

    if (!diag.editorFound) {
      const revealed = await pageCall(tabId, { kind: "REVEAL_COMMENT_BOX" });
      trace("comment.revealed", revealed);

      for (let i = 0; i < COMMENT_DIAG_POLL_ROUNDS; i++) {
        await sleep(COMMENT_DIAG_POLL_DELAY_MS);
        diag = await pageCall(tabId, { kind: "COMMENT_DIAG" });
        if (diag.editorFound) break;
      }
      trace("comment.diag.polled", diag);
    }

    if (!diag.editorFound) {
      throw withCode(
        new Error(`comment_editor_not_found href=${diag.href} readyState=${diag.readyState}`),
        "comment_editor_not_found",
      );
    }

    const typed = await pageCall(tabId, { kind: "TYPE_INTO_COMMENT", text });
    trace("comment.typed", typed);
    if (!typed.ok) {
      throw withCode(
        new Error(`comment_type_failed href=${diag.href} readyState=${diag.readyState}`),
        "comment_type_failed",
      );
    }

    // Hand the tab to the user: move it OUT of the automation window, same as
    // prepareLinkedInMessage. The user presses LinkedIn's own submit button.
    await moveTabToUserWindow(tabId);
    prepared = true;

    return { preparedAt: new Date().toISOString() };
  } catch (err) {
    throw await decorateFailure(err as Error, tabId, true);
  } finally {
    // A prepared tab belongs to the user now — only tear it down on failure.
    if (!prepared) await closeAutomationTab(tabId);
    await clearActiveTab();
  }
}

// ---------- SEARCH ----------

// Parsing lives in lib/scrape-search.ts (parseCardFields, unit-tested); the content script
// runs the DOM traversal in the page.
async function scrapeSearch(searchUrl: string): Promise<ScrapeResult> {
  const tabId = await openTabInAutomationWindow(searchUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_load");
  });
  await trackActiveTab(tabId);

  try {
    await waitForTabLoad(tabId);
    await sleep(1500);
    await throwIfCheckpoint(tabId);

    let scraped: ScrapeResult | undefined;
    // ~18s budget: scroll to trigger lazy-load, then re-scrape until cards appear or
    // LinkedIn reports "no results". Break early on either.
    for (let attempt = 0; attempt < 12; attempt++) {
      await pageCall(tabId, { kind: "SCROLL_BY", dy: 1500 });
      await sleep(1200);
      scraped = await pageCall(tabId, { kind: "SCRAPE_SEARCH" });
      if (scraped && (scraped.candidates.length > 0 || scraped.debug?.noResults === true)) break;
    }

    if (!scraped) throw withCode(new Error("scrape_returned_null"), "scrape_failed");

    return scraped;
  } finally {
    await closeAutomationTab(tabId);
    await clearActiveTab();
  }
}

// ---------- RESOLVE_COMPANY ----------

/** Resolve a company (URL or name) to its numeric LinkedIn id. */
async function resolveCompany(
  linkedinUrl: string | null,
  name: string | null,
): Promise<{
  companyId: string;
  resolvedName: string | null;
  slug: string | null;
  matchedUrl: string;
}> {
  const startUrl = linkedinUrl ?? companySearchUrl(name ?? "");
  const tabId = await openTabInAutomationWindow(startUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_load");
  });
  await trackActiveTab(tabId);

  try {
    await waitForTabLoad(tabId);
    await sleep(2500);
    await throwIfCheckpoint(tabId);

    // Name-only: find the top company result, then navigate to its page.
    if (!linkedinUrl) {
      const candidates = await pageCall(tabId, { kind: "TOP_COMPANY_RESULTS" });
      if (candidates.length === 0)
        throw withCode(new Error("company_not_found"), "not_found");
      const best = pickBestCompany(name ?? "", candidates);
      if (!best)
        throw withCode(new Error("ambiguous_match"), "ambiguous_match");
      await navigateTab(tabId, best.companyUrl);
      await waitForTabLoad(tabId);
      await sleep(2500);
      await throwIfCheckpoint(tabId);
    }

    const extracted = await pageCall(tabId, { kind: "EXTRACT_COMPANY" });
    if (!extracted.companyId) {
      throw withCode(new Error("company_id_not_found"), "no_id");
    }
    const matchedUrl = extracted.url ?? (await chrome.tabs.get(tabId)).url ?? startUrl;
    return {
      companyId: extracted.companyId,
      resolvedName: extracted.resolvedName ?? null,
      slug: companySlugFromUrl(matchedUrl),
      matchedUrl,
    };
  } finally {
    await closeAutomationTab(tabId);
    await clearActiveTab();
  }
}

// ---------- CONNECT: send a LinkedIn connection request ----------

async function sendConnectRequest(profileUrl: string): Promise<{ sentAt: string }> {
  const tabId = await openTabInAutomationWindow(profileUrl).catch(() => {
    throw withCode(new Error("tab_create_failed"), "tab_load");
  });
  await trackActiveTab(tabId);

  try {
    await waitForTabLoad(tabId);
    await sleep(4000);
    await throwIfCheckpoint(tabId);

    // The target profile's vanityName (slug) — used to scope the Connect button to THIS
    // person and exclude "People also viewed" sidebar suggestions.
    const slug = (profileUrl.split("/in/")[1] ?? "").replace(/[/?#].*/, "").toLowerCase();

    // Every click is an in-page element.click() (see lib/connect-dom.ts) — never a
    // coordinate click, which is what used to miss and produce no_connect.
    trace("profile.loaded", { url: (await chrome.tabs.get(tabId)).url?.slice(0, 120) });
    let connected = await pageCall(tabId, { kind: "CLICK_CONNECT", slug });
    trace("connect.clicked", connected);

    if (!connected) {
      // Connect may be tucked inside the "More" menu — open it, then retry.
      const openedMore = await pageCall(tabId, { kind: "CLICK_MORE" });
      trace("connect.openedMore", openedMore);
      if (openedMore) {
        await sleep(800);
        connected = await pageCall(tabId, { kind: "CLICK_CONNECT", slug });
        trace("connect.clickedAfterMore", connected);
      }
    }

    if (!connected) {
      const state = await pageCall(tabId, { kind: "PROFILE_STATE" });
      trace("profile.state", state);
      if (state === "pending") throw withCode(new Error("invitation_already_pending"), "already_pending");
      if (state === "connected") throw withCode(new Error("already_connected"), "already_connected");

      // Follow-only profile: a creator / open-profile whose primary action is "Follow" and
      // which exposes NO Connect action (not even under "More", which we already opened
      // above). You cannot send a connection request to these, so this is an intentional
      // SKIP, not a failure.
      if (await pageCall(tabId, { kind: "IS_FOLLOW_ONLY" })) {
        throw withCode(new Error("follow_only"), "follow_only");
      }

      throw withCode(new Error("connect_button_not_found"), "no_connect");
    }

    // The invite dialog ("Add a note to your invitation?") opens after a short delay. Poll
    // for its Send button and click it.
    let sent = false;
    for (let i = 0; i < 6; i++) {
      await sleep(i === 0 ? 1500 : 800);
      sent = await pageCall(tabId, { kind: "CLICK_INVITE_SEND" });
      if (sent) break;
    }
    trace("invite.sent", sent);

    if (!sent) {
      const afterButtons = await pageCall(tabId, { kind: "SCAN_BUTTONS" }).catch(() => []);
      trace("invite.buttons", afterButtons.map(b => (b.text || b.aria || "").trim()).slice(0, 12));
      // Surface the buttons that WERE on screen in the error message itself, so the
      // dashboard's "recent failures" reveals exactly what LinkedIn rendered.
      const labels = afterButtons
        .flatMap(b => { const l = (b.text || b.aria || "").trim(); return l ? [l] : []; })
        .slice(0, 12)
        .join(" | ");
      throw withCode(new Error(`send_dialog_not_found; buttons=[${labels}]`), "already_or_blocked");
    }

    await sleep(800);
    return { sentAt: new Date().toISOString() };
  } catch (err) {
    const e = err as Error & { code?: string };
    // Don't attach heavy diagnostics for benign already_* or checkpoint outcomes.
    const benign = e.code === "already_pending" || e.code === "already_connected" || e.code === "checkpoint";
    throw await decorateFailure(e, tabId, !benign);
  } finally {
    await closeAutomationTab(tabId);
    await clearActiveTab();
  }
}

/** LinkedIn interstitial verification ("checkpoint") — the account is temporarily gated. */
async function throwIfCheckpoint(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.includes("/checkpoint")) {
    throw withCode(new Error("checkpoint"), "checkpoint");
  }
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
