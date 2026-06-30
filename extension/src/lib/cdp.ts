// Chrome DevTools Protocol helpers for trusted input events on LinkedIn

const CDP_VERSION = "1.3";

// ---------- Dedicated automation window ----------
const AUTOMATION_WINDOW_KEY = "automationWindowId";

async function windowExists(id: number): Promise<boolean> {
  try { await chrome.windows.get(id); return true; } catch { return false; }
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

// Type text using CDP's insertText command (trusted)
export async function typeText(tabId: number, text: string): Promise<void> {
  await send(tabId, "Input.insertText", { text });
}

// Press a single key (Enter, etc.) with trusted keyboard events
export async function pressKey(tabId: number, key: string, keyCode: number): Promise<void> {
  await send(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown", key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
  });
  await sleep(30);
  await send(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
  });
}

// Find the "Message" action on a LinkedIn profile. Returns center coords for a
// trusted CDP click (does NOT click in-page — JS .click() is unreliable for
// LinkedIn's SPA navigation). Avoids the floating messaging panel (bottom-right).
export async function findMessageButton(tabId: number): Promise<{ x: number; y: number } | null> {
  const result = await send<{ result: { value: { x: number; y: number } | null } }>(tabId, "Runtime.evaluate", {
    expression: `(function() {
      const isMsgText = (t) => t === 'Message' || t === 'הודעה' || t === 'Message ';
      const candidates = [
        ...document.querySelectorAll('a[href*="/messaging/compose/"]'),
        ...document.querySelectorAll('button[aria-label*="Message" i]'),
        ...document.querySelectorAll('a[aria-label*="Message" i]'),
        ...document.querySelectorAll('button[aria-label*="הודעה"]'),
        ...document.querySelectorAll('a[aria-label*="הודעה"]'),
        ...[...document.querySelectorAll('a,button,[role="button"]')].filter(el => isMsgText((el.textContent || '').trim())),
      ];
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top < window.innerHeight * 0.65) {
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
      }
      return null;
    })()`,
    returnByValue: true,
  });
  return result?.result?.value ?? null;
}

type ElementCoords = { ok: boolean; composeX?: number; composeY?: number; sendX?: number; sendY?: number };

// Returns coordinates of compose area AND send button for CDP clicks
export async function getComposeCoords(tabId: number): Promise<ElementCoords> {
  const result = await send<{ result: { value: ElementCoords } }>(tabId, "Runtime.evaluate", {
    expression: `(function() {
      const compose =
        document.querySelector('div.msg-form__contenteditable[contenteditable="true"]') ||
        document.querySelector('[role="textbox"][contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]');
      if (!compose) return { ok: false };

      const cr = compose.getBoundingClientRect();
      if (cr.width === 0) return { ok: false }; // height can be 0 for flex-grow compose areas

      const btn =
        document.querySelector('button.msg-form__send-button') ||
        [...document.querySelectorAll('button[type="submit"]')].find(b =>
          b.textContent?.trim() === 'Send' || b.getAttribute('aria-label') === 'Send'
        ) || null;

      const result = {
        ok: true,
        composeX: Math.round(cr.left + cr.width / 2),
        composeY: Math.round(cr.top + cr.height / 2),
      };

      if (btn) {
        const br = btn.getBoundingClientRect();
        Object.assign(result, { sendX: Math.round(br.left + br.width / 2), sendY: Math.round(br.top + br.height / 2) });
      }

      return result;
    })()`,
    returnByValue: true,
  });
  return result?.result?.value ?? { ok: false };
}

// Focus compose editor directly — Input.insertText will then type into it
export async function focusCompose(tabId: number): Promise<boolean> {
  const result = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
    expression: `(function() {
      const selectors = [
        'div.msg-form__contenteditable[contenteditable="true"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
        '[aria-label*="message" i]',
        '[aria-label*="הודעה"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) { el.focus(); el.click(); return true; }
      }
      return false;
    })()`,
    returnByValue: true,
  });
  return result?.result?.value === true;
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

// Find element coordinates using Runtime.evaluate — runs in page context, sees all frames
export async function evalFindCompose(tabId: number): Promise<{ x: number; y: number } | null> {
  const result = await send<{ result: { value: { x: number; y: number } | null } }>(
    tabId,
    "Runtime.evaluate",
    {
      expression: `(function() {
        const selectors = [
          '[placeholder="Write a message..."]',
          '[placeholder="כתוב הודעה..."]',
          'div.msg-form__contenteditable[contenteditable="true"]',
          '[contenteditable="true"]',
          '[data-placeholder]',
          'div[role="textbox"]',
          'textarea',
        ];
        function findInDoc(doc) {
          for (const sel of selectors) {
            try {
              for (const el of doc.querySelectorAll(sel)) {
                const r = el.getBoundingClientRect();
                if (r.width > 50 && r.height > 0) {
                  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                }
              }
            } catch(e) {}
          }
          return null;
        }
        const main = findInDoc(document);
        if (main) return main;
        for (const iframe of document.querySelectorAll('iframe')) {
          try {
            const iDoc = iframe.contentDocument;
            if (!iDoc) continue;
            const fr = iframe.getBoundingClientRect();
            const found = findInDoc(iDoc);
            if (found) return { x: Math.round(fr.left + found.x), y: Math.round(fr.top + found.y) };
          } catch(e) {}
        }
        return null;
      })()`,
      returnByValue: true,
    }
  );
  return result?.result?.value ?? null;
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

// Insert text into the LinkedIn compose area using execCommand — trusted by React.
// Finds the contenteditable, focuses it, then inserts text directly.
export async function insertTextIntoCompose(tabId: number, text: string): Promise<boolean> {
  const result = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
    expression: `(function(txt) {
      // Pierce shadow DOM — LinkedIn compose is inside #interop-outlet shadowRoot
      function findEditable(root) {
        for (const sel of ['[contenteditable="true"]', '[contenteditable]', '[role="textbox"]', 'textarea']) {
          for (const el of root.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 50 && r.height > 10) return el;
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const found = findEditable(el.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      }
      const el = findEditable(document);
      if (!el) return false;
      el.focus();
      el.click();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      const result = document.execCommand('insertText', false, txt);
      return result || (el.textContent || '').includes(txt.slice(0, 10));
    })(${JSON.stringify(text)})`,
    returnByValue: true,
  });
  return result?.result?.value === true;
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

// Insert text into the compose window that belongs to a specific recipient (by name)
// Falls back to any visible compose if recipient not found
export async function insertTextIntoNamedCompose(tabId: number, text: string, recipientName: string): Promise<boolean> {
  const result = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
    expression: `(function(txt, name) {
      // Pierce shadow DOM to find all visible contenteditable elements
      function findAllEditables(root, found) {
        for (const sel of ['[contenteditable="true"]', '[contenteditable]']) {
          for (const el of root.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 50 && r.height > 10) found.push(el);
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) findAllEditables(el.shadowRoot, found);
        }
      }

      const editables = [];
      findAllEditables(document, editables);
      if (editables.length === 0) return false;

      // Try to find the compose that belongs to the correct recipient
      // by checking if the recipient name appears near the compose element
      let target = null;
      const nameLower = name.toLowerCase().split(' ')[0]; // first name
      for (const el of editables) {
        // Walk up the DOM to find a container that mentions the recipient
        let node = el.parentElement;
        for (let i = 0; i < 10 && node; i++) {
          if (node.textContent && node.textContent.toLowerCase().includes(nameLower)) {
            target = el;
            break;
          }
          node = node.parentElement;
        }
        if (target) break;
      }

      // If no match by name, use the LAST opened compose (rightmost / highest index)
      if (!target) target = editables[editables.length - 1];

      target.focus();
      target.click();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      return document.execCommand('insertText', false, txt) || (target.textContent || '').includes(txt.slice(0, 10));
    })(${JSON.stringify(text)}, ${JSON.stringify(recipientName)})`,
    returnByValue: true,
  });
  return result?.result?.value === true;
}

// Capture screenshot as base64 PNG for debugging
export async function takeScreenshot(tabId: number): Promise<string> {
  const result = await send<{ data: string }>(tabId, "Page.captureScreenshot", { format: "png", quality: 80 });
  return result.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
