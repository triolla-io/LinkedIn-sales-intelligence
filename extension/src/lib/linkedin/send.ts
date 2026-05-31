import { SEL } from "./selectors";
import { humanPause, sleep } from "../human/timing";

export async function sendMessage(text: string): Promise<{ sentAt: string; conversationUrl: string }> {
  if (location.href.includes("/checkpoint/") || document.querySelector(SEL.checkpointMarker)) {
    throw withCode(new Error("LinkedIn checkpoint detected"), "checkpoint");
  }

  await humanPause(2000, 5000);

  const msgBtn = await waitFor(SEL.messageButton, 15_000);
  if (!msgBtn) throw withCode(new Error("Message button not found"), "not_messageable");
  (msgBtn as HTMLElement).click();

  const editor = await waitFor(SEL.composeEditor, 10_000);
  if (!editor) throw withCode(new Error("Compose editor not found"), "selector_missing");

  await typeIntoEditor(editor as HTMLElement, text);
  await humanPause(800, 1500);

  const sendBtn = document.querySelector(SEL.composeSendButton) as HTMLButtonElement | null;
  if (!sendBtn) throw withCode(new Error("Send button not found"), "selector_missing");

  // If the button is still disabled, text didn't land — fail explicitly
  if (sendBtn.disabled) {
    throw withCode(new Error("Send button disabled — text did not enter editor"), "selector_missing");
  }

  await sleep(500);

  // Try clicking the send button with a full mouse event sequence
  sendBtn.focus();
  sendBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  sendBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  sendBtn.click();

  await sleep(800);

  // Fallback: press Enter in the editor (LinkedIn sends on Enter by default)
  const editorAfter = findVisible(SEL.composeEditor);
  if (editorAfter) {
    editorAfter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    editorAfter.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true }));
  }

  await humanPause(1500, 2500);
  return { sentAt: new Date().toISOString(), conversationUrl: location.href };
}

async function typeIntoEditor(el: HTMLElement, text: string): Promise<void> {
  el.focus();
  await sleep(300);

  // Method 1: execCommand — most React-compatible, fires beforeinput+input events
  // Requires the document to be active (tab must be active: true)
  el.click();
  await sleep(100);
  const inserted = document.execCommand("insertText", false, text);

  if (inserted && el.textContent?.trim()) return;

  // Method 2: Manual DOM + InputEvent — works even without user-activation
  await sleep(100);
  el.focus();

  // Clear and insert via range
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
    range.deleteContents();
  }
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  // Move cursor to end
  range.setStartAfter(textNode);
  range.collapse(true);
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }

  // Fire input event so React updates its state
  el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true, composed: true }));
  await sleep(200);
}

function waitFor(sel: string, timeoutMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = findVisible(sel);
    if (found) return resolve(found);
    const start = Date.now();
    const id = setInterval(() => {
      const el = findVisible(sel);
      if (el) { clearInterval(id); return resolve(el); }
      if (Date.now() - start > timeoutMs) { clearInterval(id); return resolve(null); }
    }, 200);
  });
}

function findVisible(sel: string): Element | null {
  const els = document.querySelectorAll(sel);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
