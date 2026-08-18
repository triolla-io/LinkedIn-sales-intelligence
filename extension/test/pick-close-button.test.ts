import { describe, it, expect } from "vitest";
import { pickCloseButton, type ScannedButton } from "../src/lib/buttons";

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
