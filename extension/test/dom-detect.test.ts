// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { detectProfileState } from "../src/lib/dom-detect";

function classify(html: string): string {
  document.body.innerHTML = html;
  return detectProfileState();
}

describe("detectProfileState", () => {
  it("reports pending when an invitation is already sent", () => {
    expect(classify(`<button aria-label="Pending, click to withdraw invitation sent to Dana">Pending</button>`)).toBe("pending");
  });
  it("reports pending for Hebrew 'ממתין'", () => {
    expect(classify(`<button aria-label="ממתין">ממתין</button>`)).toBe("pending");
  });
  it("reports connected when a Remove-connection action exists", () => {
    expect(classify(`<div><button aria-label="Remove your connection to Dana">Remove connection</button></div>`)).toBe("connected");
  });
  it("reports connectable otherwise", () => {
    expect(classify(`<button aria-label="Follow Dana">Follow</button>`)).toBe("connectable");
  });
});
