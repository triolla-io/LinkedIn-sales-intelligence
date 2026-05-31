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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
