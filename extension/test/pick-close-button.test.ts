// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { pickCloseButton, scanButtons, type ScannedButton } from "../src/lib/buttons";

// A small icon button in the top-right of the screen that is NOT inside any modal —
// e.g. a LinkedIn global-nav item like "Learning" / "For Business". The old geometric
// fallback clicked these, which navigated the tab away (the reported Learning bug).
const navIcon = (over: Partial<ScannedButton> = {}): ScannedButton => ({
  cls: "global-nav__primary-link",
  aria: "Learning",
  text: "",
  x: 1200,
  y: 10,
  w: 40,
  h: 40,
  inModal: false,
  ...over,
});

describe("pickCloseButton", () => {
  it("never returns a dismiss-looking button that is NOT inside a modal", () => {
    // Page chrome that happens to look dismissable. Clicking one of these is what moved a
    // send's tab to LinkedIn's global search page and lost the message.
    const chromeDismiss: ScannedButton = navIcon({
      aria: "Close",
      cls: "search-global-typeahead__dismiss",
      text: "×",
      inModal: false,
    });
    expect(pickCloseButton([chromeDismiss])).toBeNull();
  });

  it("keeps ignoring page chrome even when it looks like a modal dismiss", () => {
    // Defence in depth: scanButtons drops anything inside a link or the site header before
    // this runs, and pickCloseButton still requires inModal.
    expect(pickCloseButton([navIcon({ aria: "Dismiss", inModal: false })])).toBeNull();
  });

  it("returns an in-modal dismiss button", () => {
    const modalDismiss: ScannedButton = navIcon({
      aria: "Dismiss",
      cls: "artdeco-modal__dismiss",
      text: "",
      inModal: true,
    });
    expect(pickCloseButton([modalDismiss])).toBe(modalDismiss);
  });

  it("returns null when the only small top-right buttons are global-nav icons (no modal)", () => {
    const buttons = [navIcon({ aria: "Learning" }), navIcon({ aria: "For Business", x: 1250 })];
    expect(pickCloseButton(buttons)).toBeNull();
  });

  it("picks an explicit dismiss button when present", () => {
    const dismiss: ScannedButton = {
      cls: "artdeco-modal__dismiss",
      aria: "Dismiss",
      text: "",
      x: 700,
      y: 120,
      w: 32,
      h: 32,
      inModal: true,
    };
    expect(pickCloseButton([navIcon(), dismiss])).toBe(dismiss);
  });

  it("falls back to a small icon button only when it is inside a modal", () => {
    const modalX: ScannedButton = {
      cls: "some-unlabeled-close",
      aria: "",
      text: "",
      x: 760,
      y: 140,
      w: 24,
      h: 24,
      inModal: true,
    };
    expect(pickCloseButton([navIcon(), modalX])).toBe(modalX);
  });
});


describe("scanButtons", () => {
  beforeEach(() => {
    // jsdom has no layout, and collectButtons drops zero-sized buttons.
    Element.prototype.getBoundingClientRect = () =>
      ({ x: 10, y: 20, width: 120, height: 32, top: 20, left: 10, right: 130, bottom: 52, toJSON: () => ({}) }) as DOMRect;
  });

  it("sees buttons inside the shadow-root profile app, not just the outer shell", () => {
    document.body.innerHTML = `<button>Shell button</button><div id="interop-outlet"></div>`;
    const shadow = (document.getElementById("interop-outlet") as HTMLElement).attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <div role="dialog" class="artdeco-modal">
        <button>Send without a note</button>
      </div>`;

    const labels = scanButtons().map((b) => b.text);
    expect(labels).toContain("Send without a note");
    expect(labels).toContain("Shell button");
    expect(scanButtons().find((b) => b.text === "Send without a note")?.inModal).toBe(true);
  });
});
