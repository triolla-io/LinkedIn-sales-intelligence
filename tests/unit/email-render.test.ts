import { describe, it, expect } from "vitest";
import { escapeHtml, textToEmailHtml, composeEmailHtml, EMAIL_TYPOGRAPHY } from "@/lib/email/render";

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml('a < b & c > d "e"')).toBe("a &lt; b &amp; c &gt; d &quot;e&quot;");
  });
  it("leaves Hebrew intact", () => {
    expect(escapeHtml("שלום עולם")).toBe("שלום עולם");
  });
});

describe("textToEmailHtml", () => {
  it("wraps a single line in one div", () => {
    expect(textToEmailHtml("Hello")).toBe("<div>Hello</div>");
  });
  it("turns a blank line between paragraphs into a spacer div", () => {
    expect(textToEmailHtml("One\n\nTwo")).toBe("<div>One</div><div><br></div><div>Two</div>");
  });
  it("turns a lone empty body into a single spacer div", () => {
    expect(textToEmailHtml("")).toBe("<div><br></div>");
  });
  it("escapes content per line", () => {
    expect(textToEmailHtml("<b>hi</b>")).toBe("<div>&lt;b&gt;hi&lt;/b&gt;</div>");
  });
});

describe("composeEmailHtml", () => {
  it("wraps body with dir=auto and the typography spec", () => {
    const out = composeEmailHtml("Hi");
    expect(out).toContain('dir="auto"');
    expect(out).toContain(EMAIL_TYPOGRAPHY);
    expect(out).toContain("<div>Hi</div>");
    expect(out).not.toContain("white-space:pre-wrap");
  });
  it("appends signature after two blank-line spacers", () => {
    const out = composeEmailHtml("Hi", '<img src="x"><a href="y">Z</a>');
    expect(out).toContain('<div><br></div><div><br></div><img src="x"><a href="y">Z</a>');
  });
  it("omits signature spacing when signature is null or blank", () => {
    expect(composeEmailHtml("Hi", null)).not.toContain("<div><br></div><div><br></div>");
    expect(composeEmailHtml("Hi", "   ")).not.toContain("<div><br></div><div><br></div>");
  });
});
