/**
 * Page-context compose-box routines (run inside the content script).
 *
 * Typing used to go through CDP `Input.insertText`. The replacement is
 * `document.execCommand("insertText")`: the browser runs its own editing pipeline, so the
 * resulting beforeinput/input events are browser-generated (isTrusted) and React's
 * onChange fires — which is what enables LinkedIn's Send button. A manual
 * textContent + InputEvent fallback covers the case where execCommand is a no-op.
 */

import type { ComposeDiag } from "./messages";

/**
 * `document.execCommand` in a try/catch: it is deprecated-but-working in Chrome (and the
 * only way to get browser-generated, isTrusted input events), yet absent in jsdom and
 * removable in principle. A false return sends the caller to the manual fallback.
 */
function tryExec(command: string, value?: string): boolean {
  try {
    return document.execCommand?.(command, false, value) ?? false;
  } catch {
    return false;
  }
}

const EDITABLE_SELECTORS = [
  "div.msg-form__contenteditable[contenteditable]",
  '[role="textbox"][contenteditable]',
  '[contenteditable="true"]',
];

const SEND_SELECTORS = [
  "button.msg-form__send-button",
  'button[type="submit"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="שלח"]',
];

/** Send selectors specific enough to click sight-unseen when nothing reports a layout. */
const UNAMBIGUOUS_SEND_SELECTORS = [
  "button.msg-form__send-button",
  'button[aria-label*="Send"]',
  'button[aria-label*="שלח"]',
];

/** Depth-first query that pierces open shadow roots (LinkedIn renders compose in one). */
function queryDeep(selector: string, root: ParentNode = document): HTMLElement[] {
  const found: HTMLElement[] = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) found.push(...queryDeep(selector, shadow));
  }
  return found;
}

function countDeep(selector: string): number {
  try {
    return queryDeep(selector).length;
  } catch {
    return 0;
  }
}

/**
 * The compose editable. Prefers a laid-out box (width > 50) but falls back to the first
 * match: the automation window is a real, non-minimized window now, yet a throttled
 * background render can still report a zero rect for a beat, and failing the whole send
 * over a rect is exactly the `compose_insert_failed` class of bug we are removing.
 */
export function findComposeBox(): HTMLElement | null {
  for (const sel of EDITABLE_SELECTORS) {
    const matches = queryDeep(sel);
    const laidOut = matches.find((el) => el.getBoundingClientRect().width > 50);
    if (laidOut) return laidOut;
    if (matches.length > 0) return matches[0];
  }
  return null;
}

function boxText(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? "").trim();
}

/** Put the caret at the end of `el` so insertText appends instead of replacing. */
function focusAtEnd(el: HTMLElement): void {
  el.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Extract the /messaging/compose/ URL from the profile's Message button href. */
export function getComposeUrl(): string | null {
  const el = document.querySelector<HTMLAnchorElement>('a[href*="/messaging/compose/"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return el.href || null;
}

/**
 * Diagnostic snapshot of the page state when a compose step fails. Captures where the
 * tab actually is and which candidate editables exist, so we can tell a navigation
 * race (still on the profile / wrong page) apart from a missing compose box.
 */
export function composeDiag(): ComposeDiag {
  return {
    href: location.href,
    readyState: document.readyState,
    title: document.title,
    msgForm: countDeep("div.msg-form__contenteditable[contenteditable]"),
    textbox: countDeep('[role="textbox"][contenteditable]'),
    anyEditable: countDeep('[contenteditable="true"]'),
  };
}

/** Type `text` into the compose box and verify it landed. */
export function typeIntoCompose(text: string): { ok: boolean; length: number } {
  const el = findComposeBox();
  if (!el) return { ok: false, length: 0 };

  focusAtEnd(el);
  tryExec("insertText", text);

  if (!boxText(el).includes(text.trim().slice(0, 24))) {
    // execCommand was a no-op (some LinkedIn editors swallow it). Write the text and
    // announce it the way an editing command would, so React still sees a change.
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
    );
  }

  const landed = boxText(el);
  return { ok: landed.includes(text.trim().slice(0, 24)), length: landed.length };
}

/**
 * Empty every compose editable on the page.
 *
 * This is what keeps the native "Leave site?" dialog away: LinkedIn arms a beforeunload
 * handler only while an unsent draft exists, and we no longer hold a CDP session that
 * could auto-accept that dialog. Called before every navigation and before closing a tab.
 */
export function clearDraft(): { cleared: number } {
  let cleared = 0;
  for (const sel of EDITABLE_SELECTORS) {
    for (const el of queryDeep(sel)) {
      if (boxText(el) === "") continue;
      el.focus();
      tryExec("selectAll");
      tryExec("delete");
      if (boxText(el) !== "") {
        el.textContent = "";
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }),
        );
      }
      cleared++;
    }
  }
  return { cleared };
}

/** Click the Send button, then report whether LinkedIn actually cleared the box. */
export async function clickSend(): Promise<{ clicked: boolean; emptied: boolean }> {
  // Prefer a button that reports a real layout; if nothing does (throttled render), fall
  // back to an unambiguous compose Send selector rather than abandoning the send.
  const target =
    SEND_SELECTORS.flatMap((sel) => queryDeep(sel)).find(
      (el) => el.getBoundingClientRect().width > 0,
    ) ?? UNAMBIGUOUS_SEND_SELECTORS.flatMap((sel) => queryDeep(sel))[0];
  if (!target) return { clicked: false, emptied: false };
  target.click();
  const clicked = true;

  // A successful send empties the compose box. Poll for it so a click that React ignored
  // (draft never registered) is reported as a failure instead of a silent fake send.
  const box = findComposeBox();
  if (!box) return { clicked, emptied: true };
  for (let i = 0; i < 10; i++) {
    if (boxText(box) === "") return { clicked, emptied: true };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { clicked, emptied: boxText(box) === "" };
}

/** Dismiss open overlays with Escape (most reliable cross-LinkedIn method). */
export async function closeOverlays(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    for (const type of ["keydown", "keyup"] as const) {
      document.dispatchEvent(
        new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
