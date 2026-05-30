import { describe, it, expect } from "vitest";
import { generateToken, hashToken, verifyToken } from "@/lib/extension/token";

describe("extension token", () => {
  it("generateToken returns a raw token with prefix length 8 and hash", () => {
    const { raw, hash, prefix } = generateToken();
    expect(raw).toHaveLength(48);
    expect(prefix).toHaveLength(8);
    expect(raw.startsWith(prefix)).toBe(true);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashToken is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("verifyToken returns true for matching raw + hash", () => {
    const { raw, hash } = generateToken();
    expect(verifyToken(raw, hash)).toBe(true);
    expect(verifyToken(raw + "x", hash)).toBe(false);
  });
});
