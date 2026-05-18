import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptCookie, decryptCookie } from "@/lib/linkedin/cookie-crypto";

// Provide a deterministic test key
const TEST_KEY = randomBytes(32).toString("base64");

beforeAll(() => {
  process.env.LINKEDIN_COOKIE_ENC_KEY = TEST_KEY;
});

describe("cookie-crypto", () => {
  it("round-trips correctly", () => {
    const plain = "AQEDATlx...linkedin_li_at_value";
    expect(decryptCookie(encryptCookie(plain))).toBe(plain);
  });

  it("produces different ciphertext on each call (random IV)", () => {
    const plain = "same-value";
    expect(encryptCookie(plain)).not.toBe(encryptCookie(plain));
  });

  it("round-trips 100 random strings", () => {
    for (let i = 0; i < 100; i++) {
      const plain = randomBytes(Math.floor(Math.random() * 200) + 1).toString("hex");
      expect(decryptCookie(encryptCookie(plain))).toBe(plain);
    }
  });

  it("throws on tampered ciphertext", () => {
    const blob = Buffer.from(encryptCookie("secret"), "base64");
    blob[blob.length - 1] ^= 0xff; // flip last byte
    expect(() => decryptCookie(blob.toString("base64"))).toThrow();
  });

  it("throws when key is wrong length", () => {
    process.env.LINKEDIN_COOKIE_ENC_KEY = randomBytes(16).toString("base64");
    expect(() => encryptCookie("test")).toThrow("32 bytes");
    process.env.LINKEDIN_COOKIE_ENC_KEY = TEST_KEY; // restore
  });

  it("throws when env key is missing", () => {
    delete process.env.LINKEDIN_COOKIE_ENC_KEY;
    expect(() => encryptCookie("test")).toThrow("not set");
    process.env.LINKEDIN_COOKIE_ENC_KEY = TEST_KEY; // restore
  });
});
