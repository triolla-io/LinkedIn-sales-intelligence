import { describe, it, expect } from "vitest";
import { humanType } from "../../src/lib/human/type";

describe("humanType", () => {
  it("produces the target text in a textarea (typos corrected)", async () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    await humanType(ta, "hello world");
    expect(ta.value).toBe("hello world");
    document.body.removeChild(ta);
  }, 30_000);
});
