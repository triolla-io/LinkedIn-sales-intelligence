import { describe, it, expect } from "vitest";
import { stripFences, parseJsonLoose, repairTruncatedJson, clampScore } from "@/lib/tech-radar/parse";

describe("stripFences", () => {
  it("unwraps a ```json fenced body", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("unwraps a bare ``` fenced body", () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves unfenced text alone", () => {
    expect(stripFences('  {"a":1} ')).toBe('{"a":1}');
  });
});

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced JSON", () => {
    expect(parseJsonLoose('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });

  // The real production failure: a long array response is cut off mid-element and
  // JSON.parse throws, so the whole batch silently becomes zero results.
  it("recovers whole elements from an array truncated mid-object", () => {
    const truncated = '{"matches":[{"id":"a","score":1},{"id":"b","score":2},{"id":"c","sco';
    expect(parseJsonLoose<{ matches: { id: string }[] }>(truncated)?.matches.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("recovers from a truncated top-level array", () => {
    const truncated = '[{"id":"a"},{"id":"b"},{"id":';
    expect(parseJsonLoose<{ id: string }[]>(truncated)?.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("is not fooled by braces inside strings", () => {
    const truncated = '{"items":[{"text":"a } b ] c"},{"text":"next"},{"text":"cut';
    const out = parseJsonLoose<{ items: { text: string }[] }>(truncated);
    expect(out?.items.map((i) => i.text)).toEqual(["a } b ] c", "next"]);
  });

  it("handles escaped quotes inside strings", () => {
    const truncated = '{"items":[{"text":"say \\"hi\\""},{"text":"cut';
    expect(parseJsonLoose<{ items: { text: string }[] }>(truncated)?.items).toHaveLength(1);
  });

  it("returns null for prose with no JSON at all", () => {
    expect(parseJsonLoose("I'm sorry, I can't help with that.")).toBeNull();
  });

  it("returns null when nothing complete can be salvaged", () => {
    expect(parseJsonLoose('{"matches":[{"id":"a"')).toBeNull();
  });
});

describe("repairTruncatedJson", () => {
  it("returns null for already-valid JSON (not a truncation problem)", () => {
    expect(repairTruncatedJson('{"a":1}')).toBeNull();
  });
  it("closes the open containers", () => {
    expect(repairTruncatedJson('{"a":[{"b":1},{"b":')).toBe('{"a":[{"b":1}]}');
  });
  it("returns null on mismatched closers", () => {
    expect(repairTruncatedJson('{"a":[1,2}')).toBeNull();
  });
});

describe("clampScore", () => {
  it("clamps into [0,1]", () => {
    expect(clampScore(1.7)).toBe(1);
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(0.42)).toBe(0.42);
  });
  it("falls back on non-numeric input", () => {
    expect(clampScore("abc")).toBe(0.5);
    expect(clampScore(undefined, 0.1)).toBe(0.1);
    expect(clampScore(Number.NaN, 0.2)).toBe(0.2);
  });
});
