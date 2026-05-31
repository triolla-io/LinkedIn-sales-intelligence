import { humanPause, sleep } from "../human/timing";

export async function sendMessage(text: string): Promise<{ sentAt: string; conversationUrl: string }> {
  if (location.href.includes("/checkpoint/")) {
    throw withCode(new Error("LinkedIn checkpoint detected"), "checkpoint");
  }

  await humanPause(2000, 4000);

  const msgBtn = await waitFor(SEL.messageButton, 15_000);
  if (!msgBtn) throw withCode(new Error("Message button not found"), "not_messageable");
  (msgBtn as HTMLElement).click();

  const editor = await waitFor(SEL.composeEditor, 10_000);
  if (!editor) throw withCode(new Error("Compose editor not found"), "selector_missing");

  await sleep(500);
  await insertTextReact(editor as HTMLElement, text);
  await sleep(1000);

  // Verify text landed by checking send button state
  const sendBtn = findVisible(SEL.composeSendButton);
  if (!sendBtn) throw withCode(new Error("Send button not found"), "selector_missing");

  // Check aria-disabled as well as native disabled
  const isDisabled =
    (sendBtn as HTMLButtonElement).disabled ||
    sendBtn.getAttribute("aria-disabled") === "true" ||
    sendBtn.getAttribute("disabled") !== null;

  if (isDisabled) {
    throw withCode(new Error("Send button still disabled after typing — text did not enter editor"), "selector_missing");
  }

  await sleep(400);
  // Full click sequence
  (sendBtn as HTMLButtonElement).focus();
  sendBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  sendBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  (sendBtn as HTMLButtonElement).click();

  await sleep(600);

  // Fallback: press Enter in editor
  const editorNow = findVisible(SEL.composeEditor);
  if (editorNow) {
    editorNow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    editorNow.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true }));
  }

  await humanPause(2000, 3000);
  return { sentAt: new Date().toISOString(), conversationUrl: location.href };
}

// ─── Text insertion strategies ────────────────────────────────────────────────

async function insertTextReact(el: HTMLElement, text: string): Promise<void> {
  el.focus();
  await sleep(100);

  // Strategy 1: beforeinput event — React listens to this for contenteditable
  try {
    const bEvent = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    el.dispatchEvent(bEvent);
    await sleep(100);
    if (el.textContent?.trim()) return;
  } catch { /* fall through */ }

  // Strategy 2: execCommand — works when tab has user activation (active:true)
  el.focus();
  el.click();
  await sleep(50);
  const ok = document.execCommand("insertText", false, text);
  if (ok && el.textContent?.trim()) return;

  // Strategy 3: DOM range manipulation + input event (no user activation needed)
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); range.deleteContents(); }
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node); range.collapse(true);
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }

  // Fire both beforeinput and input so React processes the change
  el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
  el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

const SEL = {
  messageButton: 'button[aria-label^="Message"]',
  composeEditor: 'div.msg-form__contenteditable[contenteditable="true"]',
  composeSendButton: 'button.msg-form__send-button',
} as const;

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
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
