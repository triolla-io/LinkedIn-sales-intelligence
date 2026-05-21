import { describe, it, expect } from "vitest";

// Inline pure helpers — same pattern as other unit tests in this repo

function buildRfc2822(from: string, to: string, subject: string, body: string): string {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");
}

function encodeMessage(raw: string): string {
  return Buffer.from(raw).toString("base64url");
}

function isTokenExpired(expiresAt: number | null): boolean {
  if (!expiresAt) return true;
  return expiresAt < Math.floor(Date.now() / 1000) + 60; // 60s buffer
}

function hasGmailScope(scope: string | null): boolean {
  return scope?.includes("https://www.googleapis.com/auth/gmail.send") ?? false;
}

describe("buildRfc2822", () => {
  it("includes all required headers", () => {
    const msg = buildRfc2822("Alice <alice@example.com>", "bob@example.com", "Hello", "Hi Bob");
    expect(msg).toContain("From: Alice <alice@example.com>");
    expect(msg).toContain("To: bob@example.com");
    expect(msg).toContain("Subject: Hello");
    expect(msg).toContain("Content-Type: text/plain; charset=utf-8");
  });
  it("includes body after blank line", () => {
    const msg = buildRfc2822("a@b.com", "c@d.com", "S", "Body text");
    expect(msg).toContain("\r\n\r\nBody text");
  });
});

describe("encodeMessage", () => {
  it("produces base64url output (no +, /, or = padding)", () => {
    const encoded = encodeMessage("Hello World");
    expect(encoded).not.toMatch(/[+/=]/);
  });
  it("is decodable back to original", () => {
    const original = "From: a@b.com\r\nTo: c@d.com\r\n\r\nHello";
    expect(Buffer.from(encodeMessage(original), "base64url").toString()).toBe(original);
  });
});

describe("isTokenExpired", () => {
  it("returns true for null", () => expect(isTokenExpired(null)).toBe(true));
  it("returns true when within 60s buffer", () => {
    expect(isTokenExpired(Math.floor(Date.now() / 1000) + 30)).toBe(true);
  });
  it("returns false when far from expiry", () => {
    expect(isTokenExpired(Math.floor(Date.now() / 1000) + 3600)).toBe(false);
  });
});

describe("hasGmailScope", () => {
  it("returns true when scope contains gmail.send URL", () => {
    expect(hasGmailScope("openid email https://www.googleapis.com/auth/gmail.send")).toBe(true);
  });
  it("returns false for null", () => expect(hasGmailScope(null)).toBe(false));
  it("returns false for unrelated scopes", () => {
    expect(hasGmailScope("openid email profile")).toBe(false);
  });
});
