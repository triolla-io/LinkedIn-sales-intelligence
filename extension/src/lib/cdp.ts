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

type TypeResult = { ok: boolean; sendX?: number; sendY?: number };

// Type text into compose — returns Send button coordinates for CDP click
export async function typeIntoCompose(tabId: number, text: string): Promise<TypeResult> {
  const encoded = JSON.stringify(text);
  const result = await send<{ result: { value: TypeResult } }>(tabId, "Runtime.evaluate", {
    expression: `(function(msg) {
      const compose =
        document.querySelector('div.msg-form__contenteditable[contenteditable="true"]') ||
        document.querySelector('[role="textbox"][contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]');
      if (!compose) return { ok: false };

      compose.focus();
      compose.click();

      // execCommand — works in page JS context after CDP clicks grant user-activation
      const inserted = document.execCommand('insertText', false, msg);
      if (!inserted || !compose.textContent?.trim()) {
        compose.innerHTML = '<p>' + msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>';
        compose.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: msg, bubbles: true }));
      }

      // Find Send button and return its coordinates for CDP trusted click
      return new Promise(resolve => setTimeout(() => {
        const btn =
          document.querySelector('button.msg-form__send-button') ||
          [...document.querySelectorAll('button[type="submit"]')].find(b =>
            b.textContent?.trim() === 'Send' || b.getAttribute('aria-label') === 'Send'
          );
        if (!btn) { resolve({ ok: true }); return; }
        const r = btn.getBoundingClientRect();
        resolve({ ok: true, sendX: Math.round(r.left + r.width / 2), sendY: Math.round(r.top + r.height / 2) });
      }, 600));
    })(${encoded})`,
    returnByValue: true,
    awaitPromise: true,
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
