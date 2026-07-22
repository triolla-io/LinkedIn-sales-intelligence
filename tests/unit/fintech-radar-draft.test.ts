import { describe, it, expect } from "vitest";
import { parseDraftJson } from "@/lib/fintech-radar/draft";

describe("parseDraftJson", () => {
  it("extracts draftMessage", () => {
    expect(parseDraftJson(JSON.stringify({ draftMessage: "היי יוסי" }))).toBe("היי יוסי");
  });
  it("tolerates fences", () => {
    expect(parseDraftJson('```json\n{"draftMessage":"שלום"}\n```')).toBe("שלום");
  });
  it("returns null on empty/garbage", () => {
    expect(parseDraftJson(JSON.stringify({ draftMessage: "  " }))).toBeNull();
    expect(parseDraftJson("nope")).toBeNull();
  });
});
