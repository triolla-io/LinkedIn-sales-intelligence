/**
 * Page-context comment-box routines (run inside the content script).
 *
 * A LinkedIn post's comment editor is often collapsed behind a "Comment" / "תגובה"
 * button; clicking it swaps in a Quill-style `.ql-editor`. Same insertion technique as
 * compose.ts (see that file's header comment for why): `execCommand("insertText")` runs
 * the browser's own editing pipeline so the resulting events are isTrusted and React's
 * onChange fires — which is what enables LinkedIn's own submit button. A manual
 * textContent + InputEvent covers the case where execCommand is a no-op.
 *
 * `commentDiag` is a pure read — it must never click anything. Task 6 polls it up to 30
 * times while waiting for the editor to appear; a click-on-diag would fire the comment
 * button up to 30 times, which can toggle an already-open editor back shut and reads as
 * automation. Revealing the box is a separate, explicit, single-shot action
 * (`revealCommentBox`).
 *
 * In-page el.click() only — never coordinate clicks: the automation window can lay out
 * 0×0, and a coordinate click then lands nowhere.
 */

/** Depth-first query that pierces open shadow roots (LinkedIn renders parts of a post's
 * UI, including comment boxes, inside one). */
function queryDeep(selector: string, root: ParentNode = document): HTMLElement[] {
  const found: HTMLElement[] = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) found.push(...queryDeep(selector, shadow));
  }
  return found;
}

/** `document.execCommand` in a try/catch: deprecated-but-working in Chrome (and the only
 * way to get browser-generated, isTrusted input events), yet absent in jsdom and
 * removable in principle. A false return sends the caller to the manual fallback. */
function tryExec(command: string, value?: string): boolean {
  try {
    return document.execCommand?.(command, false, value) ?? false;
  } catch {
    return false;
  }
}

const EDITOR_SELECTOR = [
  ".comments-comment-box .ql-editor",
  ".comments-comment-texteditor .ql-editor",
  '.comments-comment-box [contenteditable="true"][role="textbox"]',
].join(", ");

function findEditor(): HTMLElement | null {
  return queryDeep(EDITOR_SELECTOR)[0] ?? null;
}

/**
 * Whether a label (aria-label, or a button's own visible text) identifies the comment
 * action itself — not merely a count badge like "42 comments" that happens to contain
 * the same substring. A leading digit rules out a count; requiring the label to *start*
 * with "comment"/"תגובה" (as a whole word, not a prefix of a longer word) rules out
 * anything else that mentions comments in passing.
 */
function isCommentLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (/^\d/.test(t)) return false; // "42 comments", "3 תגובות" — a count, not the action
  if (t === "תגובה" || t.startsWith("תגובה ")) return true;
  if (/^comment(\s|$)/i.test(t)) return true; // "Comment", "Comment on Dana's post"
  return false;
}

function findCommentButton(): HTMLElement | null {
  const withAriaLabel = queryDeep("button[aria-label]").filter((btn) =>
    isCommentLabel(btn.getAttribute("aria-label") ?? ""),
  );
  if (withAriaLabel.length > 0) return withAriaLabel[0];
  // Fallback: a button whose own visible text is exactly the comment action.
  return queryDeep("button").find((btn) => isCommentLabel(btn.textContent ?? "")) ?? null;
}

/**
 * Pure diagnostic snapshot — clicks nothing. `href`/`readyState` are included the way
 * `composeDiag()` includes them, so a production failure ("editor never appeared") can be
 * told apart from being on the wrong page entirely versus the right page with no editor.
 */
export function commentDiag(): {
  editorFound: boolean;
  commentButtonFound: boolean;
  href: string;
  readyState: string;
} {
  const editor = findEditor();
  const commentButtonFound = editor ? false : findCommentButton() !== null;
  return {
    editorFound: editor !== null,
    commentButtonFound,
    href: location.href,
    readyState: document.readyState,
  };
}

/** Find the comment button and click it once, in-page, to reveal the editor. */
export function revealCommentBox(): { clicked: boolean } {
  const button = findCommentButton();
  if (!button) return { clicked: false };
  button.click();
  return { clicked: true };
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

/** Type `text` into the comment editor and verify it landed. */
export function typeIntoComment(text: string): { ok: boolean; length: number } {
  const el = findEditor();
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
