// Chrome DevTools Protocol helpers for trusted input events on LinkedIn

const CDP_VERSION = "1.3";

// ---------- Dedicated automation window ----------
// All prospecting automation runs in ONE separate Chrome window that is never focused,
// so it does not steal focus from the user. Created lazily; recreated if the user closes it.
let automationWindowId: number | null = null;

async function windowExists(id: number): Promise<boolean> {
  try {
    await chrome.windows.get(id);
    return true;
  } catch {
    return false;
  }
}

/** Get (or lazily create) the dedicated, non-focused automation window. Returns its windowId. */
export async function getAutomationWindow(): Promise<number> {
  if (automationWindowId !== null && (await windowExists(automationWindowId))) {
    return automationWindowId;
  }
  // Try minimized first (fully out of the way). If a later live test shows clicks don't land in a
  // minimized window, switch `state` to "normal" with an off-screen `left` (see plan fallback).
  const win = await chrome.windows.create({ focused: false, state: "minimized" });
  if (!win?.id) throw new Error("automation_window_create_failed");
  automationWindowId = win.id;
  return automationWindowId;
}

/** Open a tab inside the automation window WITHOUT focusing the window. Returns the tabId. */
export async function openTabInAutomationWindow(url: string): Promise<number> {
  const windowId = await getAutomationWindow();
  const tab = await chrome.tabs.create({ windowId, url, active: true });
  if (!tab.id) throw new Error("tab_create_failed");
  return tab.id;
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

// Scan page for visible buttons — returns list for debugging
export async function scanButtons(tabId: number): Promise<Array<{cls: string; aria: string; text: string; x: number; y: number; w: number; h: number}>> {
  const result = await send<{ result: { value: unknown } }>(tabId, "Runtime.evaluate", {
    expression: `[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,
    returnByValue: true,
  });
  return (result?.result?.value as Array<{cls: string; aria: string; text: string; x: number; y: number; w: number; h: number}>) ?? [];
}

// Find and click any modal dismiss/close button on the page
export async function clickModalClose(tabId: number): Promise<boolean> {
  const buttons = await scanButtons(tabId);

  // Try known selectors first (exact aria-label or class)
  for (const btn of buttons) {
    const isClose =
      /^(dismiss|close|cancel)$/i.test(btn.aria) ||
      /artdeco-modal__dismiss/i.test(btn.cls) ||
      /dismiss/i.test(btn.cls) ||
      btn.text === '×' || btn.text === '✕' || btn.text === '✖';
    if (isClose) {
      await click(tabId, btn.x + Math.round(btn.w / 2), btn.y + Math.round(btn.h / 2));
      return true;
    }
  }

  // Broad fallback: small button (likely X) in top area, near right side of screen
  const screenWidth = await getScreenWidth(tabId);
  const closeCandidate = buttons.find(b => b.w < 50 && b.h < 50 && b.y < 300 && b.x > screenWidth * 0.4);
  if (closeCandidate) {
    await click(tabId, closeCandidate.x + Math.round(closeCandidate.w / 2), closeCandidate.y + Math.round(closeCandidate.h / 2));
    return true;
  }

  return false;
}

async function getScreenWidth(tabId: number): Promise<number> {
  const result = await send<{ result: { value: number } }>(tabId, "Runtime.evaluate", {
    expression: "window.innerWidth",
    returnByValue: true,
  });
  return result?.result?.value ?? 1440;
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
