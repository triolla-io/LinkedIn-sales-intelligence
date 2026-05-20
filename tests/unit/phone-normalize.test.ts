import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/whatsapp/phone";

describe("normalizePhone", () => {
  it("returns E.164 for a valid E.164 input", () => {
    expect(normalizePhone("+16505551234")).toBe("+16505551234");
  });

  it("strips spaces and dashes", () => {
    expect(normalizePhone("+1 650-555-1234")).toBe("+16505551234");
  });

  it("adds leading + if missing", () => {
    expect(normalizePhone("16505551234")).toBe("+16505551234");
  });

  it("handles Israeli mobile numbers", () => {
    expect(normalizePhone("+972501234567")).toBe("+972501234567");
  });

  it("returns null for a short garbage string", () => {
    expect(normalizePhone("not-a-phone")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(normalizePhone("   ")).toBeNull();
  });

  it("strips parentheses and dots", () => {
    expect(normalizePhone("+1 (650) 555.1234")).toBe("+16505551234");
  });
});
