/**
 * Button scanning + close-button selection.
 *
 * `pickCloseButton` is pure (unit-tested); `scanButtons` / `clickModalClose` run in the
 * page via the content script.
 */

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

/** Selectors for containers that count as a dismissible overlay. A close button only
 * makes sense inside one of these — anything outside is page chrome, never a dismiss. */
const MODAL_CONTAINER_SEL =
  '[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';

/**
 * Never-click zone. A dismiss control is never a link and never lives in the site header,
 * so anything matching this is disqualified no matter how "closeable" it looks. Clicking
 * one of these is how a send ended up on LinkedIn's global search page with the profile
 * left behind.
 */
const NEVER_CLICK_SEL = "a[href],.global-nav,header,nav,[role=\"banner\"],[role=\"navigation\"]";

/** Page-context: describe every visible button in the upper part of the viewport. */
export function scanButtons(): ScannedButton[] {
  return collectButtons().map((b) => b.meta);
}

/**
 * Choose which scanned button (if any) to click to dismiss a modal. Pure so it can be
 * unit-tested without a browser. Returns null when there is nothing safe to click — which
 * MUST be the case on a clean profile page with only nav icons.
 */
export function pickCloseButton(buttons: ScannedButton[]): ScannedButton | null {
  // EVERY candidate must sit inside a real modal/dialog/toast. Nothing outside one is a
  // dismiss affordance — it is page chrome, and clicking page chrome is what navigates the
  // tab away from the profile. That cost us a send: the failure was captured on
  // /search/results/all/?origin=GLOBAL_SEARCH_HEADER (an empty global search) while the
  // tab title still read the contact's name.
  const inModal = buttons.filter((b) => b.inModal);

  // 1. Explicit dismiss affordance (reliable aria-label / class / glyph).
  for (const btn of inModal) {
    const isClose =
      /^(dismiss|close|cancel)$/i.test(btn.aria) ||
      /artdeco-modal__dismiss/i.test(btn.cls) ||
      /dismiss/i.test(btn.cls) ||
      btn.text === "×" || btn.text === "✕" || btn.text === "✖";
    if (isClose) return btn;
  }

  // 2. Fallback: a small unlabeled icon button inside that modal.
  return inModal.find((b) => b.w < 50 && b.h < 50) ?? null;
}

/** Page-context: find and click a modal dismiss/close button. Returns false when none. */
export function clickModalClose(): boolean {
  const collected = collectButtons();
  const target = pickCloseButton(collected.map((c) => c.meta));
  if (!target) return false;
  const hit = collected.find((c) => c.meta === target);
  if (!hit) return false;
  hit.el.click();
  return true;
}

function collectButtons(): Array<{ el: HTMLElement; meta: ScannedButton }> {
  const out: Array<{ el: HTMLElement; meta: ScannedButton }> = [];
  for (const node of Array.from(document.querySelectorAll('button,[role="button"]'))) {
    const el = node as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.top >= 800) continue;
    if (el.closest(NEVER_CLICK_SEL)) continue;
    out.push({
      el,
      meta: {
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 80),
        aria: el.getAttribute("aria-label") ?? "",
        text: el.textContent?.trim().slice(0, 30) ?? "",
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inModal: !!el.closest(MODAL_CONTAINER_SEL),
      },
    });
  }
  return out;
}
