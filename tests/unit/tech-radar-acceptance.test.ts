import { describe, it, expect } from "vitest";
import { judgeAcceptance, isIsraeliSource, MIN_WEIGHTY, MIN_ISRAELI } from "@/lib/tech-radar/acceptance";

describe("isIsraeliSource", () => {
  it("recognises the Israeli business press", () => {
    for (const u of [
      "https://www.globes.co.il/news/article.html",
      "https://calcalist.co.il/x",
      "https://www.themarker.com/y",
      "https://bizportal.co.il/z",
    ]) {
      expect(isIsraeliSource(u), u).toBe(true);
    }
  });

  /** Suffix matching on a dot boundary, so a lookalike host cannot pass. */
  it("is not fooled by a lookalike host", () => {
    expect(isIsraeliSource("https://notglobes.co.il.evil.com/x")).toBe(false);
    expect(isIsraeliSource("https://globes.co.il.attacker.net/x")).toBe(false);
  });

  it("rejects foreign sources and junk", () => {
    expect(isIsraeliSource("https://www.nature.com/a")).toBe(false);
    expect(isIsraeliSource("not a url")).toBe(false);
    expect(isIsraeliSource(null)).toBe(false);
  });
});

describe("judgeAcceptance", () => {
  const weighty = (url = "https://mckinsey.com/r") => ({ kind: "research" as const, stature: 0.8, url });
  const light = (url = "https://pgjonline.com/t") => ({ kind: "trend" as const, stature: 0.2, url });

  /**
   * The exact shape of the 2026-08-23 run: relevant items with no weight. It must fail,
   * because "on topic" was never the bar.
   */
  it("fails a run of on-topic weightless items", () => {
    const r = judgeAcceptance([light(), light("https://nature.com/x"), light()]);
    expect(r.met).toBe(false);
    expect(r.weighty).toBe(0);
    expect(r.shortfall).toMatch(/נסרק ולא נמצא/);
  });

  it("passes a run with two weighty items and one Israeli source", () => {
    const r = judgeAcceptance([
      weighty(),
      { kind: "big_news" as const, stature: 0.9, url: "https://www.globes.co.il/a" },
    ]);
    expect(r).toMatchObject({ weighty: MIN_WEIGHTY, israeli: MIN_ISRAELI, met: true, shortfall: "" });
  });

  /**
   * A flagship KIND at low stature does not count. That combination is precisely what
   * slipped through before: a Nature paper on an injection polymer is kind "research".
   */
  it("does not count a flagship kind that carries no weight", () => {
    const r = judgeAcceptance([
      { kind: "research", stature: 0.2, url: "https://www.globes.co.il/a" },
      { kind: "research", stature: 0.2, url: "https://mckinsey.com/b" },
    ]);
    expect(r.weighty).toBe(0);
    expect(r.israeli).toBe(1);
    expect(r.met).toBe(false);
  });

  /** Nor does a weighty item of a kind that is not a gift. */
  it("does not count a weighty vendor launch", () => {
    expect(judgeAcceptance([{ kind: "vendor_launch", stature: 0.9, url: "https://x.com/a" }]).weighty).toBe(0);
  });

  it("names each missing half separately", () => {
    const noIsraeli = judgeAcceptance([weighty(), weighty("https://bcg.com/b")]);
    expect(noIsraeli.met).toBe(false);
    expect(noIsraeli.shortfall).toMatch(/ממקור ישראלי: 0/);
    expect(noIsraeli.shortfall).not.toMatch(/דוח-דגל/);

    const noWeight = judgeAcceptance([light("https://www.globes.co.il/a")]);
    expect(noWeight.shortfall).toMatch(/דוח-דגל/);
    expect(noWeight.shortfall).not.toMatch(/ממקור ישראלי/);
  });

  /** An empty run reports the shortfall rather than passing vacuously. */
  it("fails an empty run", () => {
    const r = judgeAcceptance([]);
    expect(r.met).toBe(false);
    expect(r.shortfall).toMatch(/0 מתוך 2/);
  });
});
