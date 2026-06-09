import { describe, it, expect } from "vitest";
import { escapeHtml, htmlBody, buildRfc2822 } from "@/lib/gmail/client";

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml('a < b & c > d "e"')).toBe("a &lt; b &amp; c &gt; d &quot;e&quot;");
  });
  it("leaves Hebrew text intact", () => {
    expect(escapeHtml("שלום עולם")).toBe("שלום עולם");
  });
});

describe("htmlBody", () => {
  it("wraps body in a dir=auto, pre-wrap container", () => {
    const out = htmlBody("Hello\nWorld");
    expect(out).toContain('dir="auto"');
    expect(out).toContain("white-space:pre-wrap");
    expect(out).toContain("Hello\nWorld");
  });
  it("escapes the body so injected markup is inert", () => {
    expect(htmlBody("<script>x</script>")).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});

describe("buildRfc2822", () => {
  it("declares an HTML content type", () => {
    const msg = buildRfc2822("a@b.com", "c@d.com", "Subject", "שלום");
    expect(msg).toContain("Content-Type: text/html; charset=utf-8");
    expect(msg).not.toContain("Content-Type: text/plain");
  });
  it("base64-encodes the HTML body (decodable, contains dir=auto)", () => {
    const msg = buildRfc2822("a@b.com", "c@d.com", "S", "שלום עולם");
    const b64 = msg.split("\r\n\r\n")[1];
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    expect(decoded).toContain('dir="auto"');
    expect(decoded).toContain("שלום עולם");
  });
});
