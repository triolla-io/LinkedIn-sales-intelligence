// Chrome DevTools Protocol helpers for trusted input events on LinkedIn

const CDP_VERSION = "1.3";

// ---------- Dedicated automation window ----------
const AUTOMATION_WINDOW_KEY = "automationWindowId";

async function windowExists(id: number): Promise<boolean> {
  try { await chrome.windows.get(id); return true; } catch { return false; }
}

// Auto-dismiss native JS dialogs (alert / confirm / beforeunload) on ANY attached tab.
// LinkedIn arms a `beforeunload` handler whenever the compose box holds an unsent draft,
// so navigating or closing that tab would otherwise surface the native "Leave site?"
// prompt — which forces the minimized automation window to the foreground and blocks
// until the user clicks. Accepting a beforeunload dialog means "leave the page", which is
// exactly what we want when tearing an automation tab down. Registered once at module
// load; re-registers on every service-worker restart because the module re-runs.
// Guarded so importing this module in a non-extension context (unit tests) is a no-op.
if (typeof chrome !== "undefined" && chrome.debugger?.onEvent) {
  chrome.debugger.onEvent.addListener((source, method) => {
    if (method !== "Page.javascriptDialogOpening" || source.tabId === undefined) return;
    chrome.debugger.sendCommand(
      { tabId: source.tabId },
      "Page.handleJavaScriptDialog",
      { accept: true },
      () => { void chrome.runtime.lastError; }, // tab may have detached — ignore
    );
  });
}

/** Get (or lazily create) the dedicated, non-focused automation window. Returns its windowId. */
export async function getAutomationWindow(): Promise<number> {
  const stored = await chrome.storage.local.get(AUTOMATION_WINDOW_KEY);
  const cached: number | undefined = stored[AUTOMATION_WINDOW_KEY];
  if (cached !== undefined && (await windowExists(cached))) return cached;
  // Stale or missing — close any orphan first, then create a fresh one.
  if (cached !== undefined) await chrome.windows.remove(cached).catch(() => {});
  const win = await chrome.windows.create({ focused: false, state: "minimized" });
  if (!win?.id) throw new Error("automation_window_create_failed");
  await chrome.storage.local.set({ [AUTOMATION_WINDOW_KEY]: win.id });
  return win.id;
}

/**
 * Open a tab inside the automation window WITHOUT focusing the window. Returns the tabId.
 *
 * `active` defaults to true because scraping relies on `innerText`, which needs the tab
 * rendered. Pass `active: false` for flows that drive the page purely via selectors / CDP
 * (e.g. message sending): an inactive tab never restores the minimized window, so the run
 * stays fully in the background instead of popping to the foreground every time. Such flows
 * MUST force a layout viewport via Emulation.setDeviceMetricsOverride, since a never-
 * foregrounded tab can otherwise lay out at 0×0 and break getBoundingClientRect checks.
 */
export async function openTabInAutomationWindow(url: string, active = true): Promise<number> {
  const windowId = await getAutomationWindow();
  const tab = await chrome.tabs.create({ windowId, url, active });
  if (!tab.id) throw new Error("tab_create_failed");
  // Activating a tab restores (un-minimizes) its window, so an active tab would pop the
  // automation window to the foreground and "take over the screen". Push it back down.
  // (Harmless when active=false — the window was never raised.) CDP works minimized.
  await chrome.windows.update(windowId, { focused: false, state: "minimized" }).catch(() => {});
  return tab.id;
}

/** Called at startup: close any stale automation window left from a previous SW session. */
export async function closeStaleAutomationWindow(): Promise<void> {
  const stored = await chrome.storage.local.get(AUTOMATION_WINDOW_KEY);
  const cached: number | undefined = stored[AUTOMATION_WINDOW_KEY];
  if (cached !== undefined && !(await windowExists(cached))) {
    await chrome.storage.local.remove(AUTOMATION_WINDOW_KEY);
  }
  // If the window still exists from a prior session, leave it — getAutomationWindow will reuse it.
}

export async function attach(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
  // Enable the Page domain so Page.javascriptDialogOpening events fire and the global
  // listener above can auto-dismiss LinkedIn's "Leave site?" beforeunload prompt.
  await send(tabId, "Page.enable").catch(() => {});
}

export async function detach(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      // Ignore errors — debugger might already be detached
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

export async function send<T = unknown>(
  tabId: number,
  method: string,
  params: object = {}
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result as T);
    });
  });
}

// Click at viewport coordinates with full mouse event sequence
export async function click(tabId: number, x: number, y: number): Promise<void> {
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved", x, y, button: "none", buttons: 0,
  });
  await sleep(50);
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1,
  });
  await sleep(50);
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1,
  });
}

// Extract the /messaging/compose/ URL from the profile's Message button href.
// Returns null if the profile has no messageable button (not connected, etc.).
export async function getComposeUrl(tabId: number): Promise<string | null> {
  const result = await send<{ result: { value: string | null } }>(tabId, "Runtime.evaluate", {
    expression: `(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,
    returnByValue: true,
  });
  return result?.result?.value ?? null;
}

// Type text into the LinkedIn compose box using CDP Input.insertText, which fires
// the synthetic keyboard events React listens to (enabling the Send button).
// Must be called after the /messaging/compose/ page has fully loaded.
export async function typeIntoCompose(tabId: number, text: string): Promise<boolean> {
  // Focus the contenteditable via JavaScript first.
  const focused = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
    expression: `(function() {
      function findEl(root) {
        for (const sel of ['div.msg-form__contenteditable[contenteditable]','[role="textbox"][contenteditable]','[contenteditable="true"]']) {
          const el = root.querySelector(sel);
          if (el) { const r = el.getBoundingClientRect(); if (r.width > 50) return el; }
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const f = findEl(el.shadowRoot); if (f) return f; }
      }
      const el = findEl(document);
      if (!el) return false;
      el.focus();
      el.click();
      return true;
    })()`,
    returnByValue: true,
  });
  if (!focused?.result?.value) return false;

  // Insert text via CDP — fires keydown/keypress/input/keyup which React handles.
  await send(tabId, "Input.insertText", { text });
  return true;
}

// Diagnostic snapshot of the page state when a compose step fails. Captures where the
// tab actually is and which candidate editables exist, so we can tell a navigation
// race (still on the profile / wrong page) apart from a missing compose box.
export async function composeDiag(tabId: number): Promise<Record<string, unknown>> {
  const r = await send<{ result: { value: Record<string, unknown> } }>(tabId, "Runtime.evaluate", {
    expression: `(function() {
      const countDeep = (sel) => {
        let n = 0;
        const walk = (root) => {
          n += root.querySelectorAll(sel).length;
          for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
        };
        try { walk(document); } catch (e) {}
        return n;
      };
      return {
        href: location.href,
        readyState: document.readyState,
        title: document.title,
        msgForm: countDeep('div.msg-form__contenteditable[contenteditable]'),
        textbox: countDeep('[role="textbox"][contenteditable]'),
        anyEditable: countDeep('[contenteditable="true"]'),
      };
    })()`,
    returnByValue: true,
  });
  return r?.result?.value ?? { diag: "eval_failed" };
}

// Click the Send button inside LinkedIn's shadow DOM compose
export async function clickSendButton(tabId: number): Promise<boolean> {
  const result = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
    expression: `(function() {
      function findSend(root) {
        for (const sel of [
          'button.msg-form__send-button',
          'button[type="submit"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="שלח"]',
        ]) {
          for (const el of root.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) { el.click(); return true; }
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            if (findSend(el.shadowRoot)) return true;
          }
        }
        return false;
      }
      return findSend(document);
    })()`,
    returnByValue: true,
  });
  return result?.result?.value === true;
}

export interface ScannedButton {
  cls: string;
  aria: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // Whether the button lives inside an actual modal/dialog/toast container.
  // The geometric close-button fallback only fires for in-modal buttons — clicking
  // chrome (the global nav) is what navigated the tab to LinkedIn Learning.
  inModal: boolean;
}

// Selectors for containers that count as a dismissible overlay. A close button only
// makes sense inside one of these — anything outside is page chrome, never a dismiss.
const MODAL_CONTAINER_SEL =
  '[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';

// Scan page for visible buttons — returns list for debugging and close-button detection.
export async function scanButtons(tabId: number): Promise<ScannedButton[]> {
  const result = await send<{ result: { value: unknown } }>(tabId, "Runtime.evaluate", {
    expression: `[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${MODAL_CONTAINER_SEL}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,
    returnByValue: true,
  });
  return (result?.result?.value as ScannedButton[]) ?? [];
}

// Choose which scanned button (if any) to click to dismiss a modal. Pure so it can be
// unit-tested without CDP. Returns null when there is nothing safe to click — which
// MUST be the case on a clean profile page with only nav icons.
export function pickCloseButton(buttons: ScannedButton[]): ScannedButton | null {
  // 1. Explicit dismiss affordance (reliable aria-label / class / glyph).
  for (const btn of buttons) {
    const isClose =
      /^(dismiss|close|cancel)$/i.test(btn.aria) ||
      /artdeco-modal__dismiss/i.test(btn.cls) ||
      /dismiss/i.test(btn.cls) ||
      btn.text === '×' || btn.text === '✕' || btn.text === '✖';
    if (isClose) return btn;
  }

  // 2. Fallback: a small unlabeled icon button, but ONLY when it sits inside a real
  //    modal/dialog. Never guess at page chrome — that is how we used to click the
  //    global-nav "Learning" / "For Business" links and navigate the tab away.
  return buttons.find(b => b.inModal && b.w < 50 && b.h < 50) ?? null;
}

// Find and click any modal dismiss/close button on the page
export async function clickModalClose(tabId: number): Promise<boolean> {
  const buttons = await scanButtons(tabId);
  const target = pickCloseButton(buttons);
  if (!target) return false;
  await click(tabId, target.x + Math.round(target.w / 2), target.y + Math.round(target.h / 2));
  return true;
}

// Scroll the page by deltaY pixels using a mouseWheel event at viewport center
export async function scrollBy(tabId: number, dy: number): Promise<void> {
  const result = await send<{ result: { value: { w: number; h: number } } }>(tabId, "Runtime.evaluate", {
    expression: "({ w: window.innerWidth, h: window.innerHeight })",
    returnByValue: true,
  });
  const { w, h } = result?.result?.value ?? { w: 1440, h: 900 };
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: Math.round(w / 2),
    y: Math.round(h / 2),
    deltaX: 0,
    deltaY: dy,
  });
}

// Close ALL open compose overlays using Escape key (most reliable cross-LinkedIn method)
export async function closeAllComposeOverlays(tabId: number): Promise<void> {
  // Press Escape multiple times to dismiss any open compose overlays
  for (let i = 0; i < 5; i++) {
    await send(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    });
    await sleep(50);
    await send(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    });
    await sleep(150);
  }
}

// Capture screenshot as base64 PNG for debugging
export async function takeScreenshot(tabId: number): Promise<string> {
  const result = await send<{ data: string }>(tabId, "Page.captureScreenshot", { format: "png", quality: 80 });
  return result.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
