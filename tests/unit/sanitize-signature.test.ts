import { describe, it, expect } from "vitest";
import { sanitizeSignature } from "@/lib/email/sanitize-signature";

describe("sanitizeSignature", () => {
  it("keeps images, links, tables, and inline styles", () => {
    const html = '<table><tr><td><img src="https://x/logo.png" style="width:40px"><a href="https://triolla.io">Triolla</a></td></tr></table>';
    const out = sanitizeSignature(html);
    expect(out).toContain("<img");
    expect(out).toContain('src="https://x/logo.png"');
    expect(out).toContain('style="width:40px"');
    expect(out).toContain('href="https://triolla.io"');
    expect(out).toContain("<table");
  });
  it("strips script tags", () => {
    expect(sanitizeSignature('<div>ok</div><script>alert(1)</script>')).not.toContain("<script");
  });
  it("strips inline event handlers", () => {
    expect(sanitizeSignature('<img src="x" onerror="alert(1)">')).not.toContain("onerror");
  });
  it("strips javascript: URLs", () => {
    expect(sanitizeSignature('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
  });
  it("returns empty string for non-string input", () => {
    // @ts-expect-error testing runtime guard
    expect(sanitizeSignature(null)).toBe("");
  });
});
