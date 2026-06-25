import { describe, it, expect } from "vitest";
import { isIsraeliMobile, toIsraeliE164 } from "@/lib/phone/normalize";

describe("toIsraeliE164", () => {
  it("repairs the Apollo/HubSpot '+1' mis-prefix on an Israeli mobile (drops the trunk 0)", () => {
    // The documented bug: was producing "+9720506463464" (invalid, extra 0)
    expect(toIsraeliE164("+10506463464")).toBe("+972506463464");
  });

  it("repairs an extra trunk 0 after the country code", () => {
    expect(toIsraeliE164("+9720506463464")).toBe("+972506463464");
  });

  it("converts a local Israeli mobile (05...) to E.164", () => {
    expect(toIsraeliE164("0506463464")).toBe("+972506463464");
  });

  it("strips formatting (spaces, dashes, parens, dots)", () => {
    expect(toIsraeliE164("050-646-3464")).toBe("+972506463464");
    expect(toIsraeliE164("+972 (50) 646.3464")).toBe("+972506463464");
  });

  it("leaves an already-correct +972 number unchanged", () => {
    expect(toIsraeliE164("+972506463464")).toBe("+972506463464");
  });

  it("preserves a legitimate non-Israeli (+1 US) number — does NOT mangle it", () => {
    // 650-555-1234 is a valid US number; must not be re-homed to +972
    expect(toIsraeliE164("+16505551234")).toBe("+16505551234");
  });

  it("converts an Israeli landline (0X) to E.164", () => {
    expect(toIsraeliE164("036463464")).toBe("+97236463464");
  });

  it("returns null for empty / whitespace / null / garbage", () => {
    expect(toIsraeliE164("")).toBeNull();
    expect(toIsraeliE164("   ")).toBeNull();
    expect(toIsraeliE164(null)).toBeNull();
    expect(toIsraeliE164(undefined)).toBeNull();
    expect(toIsraeliE164("not-a-phone")).toBeNull();
  });
});

describe("isIsraeliMobile", () => {
  it("accepts Israeli mobile prefixes (05X)", () => {
    expect(isIsraeliMobile("+972506463464")).toBe(true); // 050
    expect(isIsraeliMobile("+972521234567")).toBe(true); // 052
    expect(isIsraeliMobile("+972581234567")).toBe(true); // 058
  });

  it("rejects Israeli landline numbers", () => {
    expect(isIsraeliMobile("+97226701234")).toBe(false); // 02
    expect(isIsraeliMobile("+97235123456")).toBe(false); // 03
    expect(isIsraeliMobile("+97297654321")).toBe(false); // 09
  });

  it("rejects Israeli VoIP / non-geographic numbers", () => {
    expect(isIsraeliMobile("+972732345678")).toBe(false); // 073
    expect(isIsraeliMobile("+972773334444")).toBe(false); // 077
    expect(isIsraeliMobile("+972722501234")).toBe(false); // 072
  });

  it("rejects non-Israeli numbers", () => {
    expect(isIsraeliMobile("+16505551234")).toBe(false);
  });

  it("rejects null / empty / unparseable", () => {
    expect(isIsraeliMobile(null)).toBe(false);
    expect(isIsraeliMobile(undefined)).toBe(false);
    expect(isIsraeliMobile("")).toBe(false);
    expect(isIsraeliMobile("not a phone")).toBe(false);
  });
});
