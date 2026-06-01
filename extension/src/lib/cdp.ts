// Chrome DevTools Protocol helpers for trusted input events on LinkedIn

const CDP_VERSION = "1.3";

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

// Simulate Ctrl+V paste — fires trusted paste event that React handles
export async function pasteFromClipboard(tabId: number): Promise<void> {
  await send(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown", key: "Control", code: "ControlLeft",
    windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0,
  });
  await sleep(50);
  await send(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown", key: "v", code: "KeyV",
    windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2,
  });
  await sleep(50);
  await send(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp", key: "v", code: "KeyV",
    windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2,
  });
  await sleep(50);
  await send(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp", key: "Control", code: "ControlLeft",
    windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0,
  });
}

// Capture screenshot as base64 PNG for debugging
export async function takeScreenshot(tabId: number): Promise<string> {
  const result = await send<{ data: string }>(tabId, "Page.captureScreenshot", { format: "png", quality: 80 });
  return result.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
