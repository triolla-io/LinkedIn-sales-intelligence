// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { PROFILE_STATE_FN_SOURCE } from "../src/lib/dom-detect";

function classify(html: string): string {
  document.body.innerHTML = html;
  // PROFILE_STATE_FN_SOURCE is an IIFE string — eval it in the jsdom context.
  // eslint-disable-next-line no-eval
  return eval(PROFILE_STATE_FN_SOURCE) as string;
}

describe("PROFILE_STATE_FN_SOURCE", () => {
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
