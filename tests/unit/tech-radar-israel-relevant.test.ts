import { describe, it, expect } from "vitest";

import { parseTriageResponse } from "@/lib/tech-radar/triage";
import { judgeAcceptance } from "@/lib/tech-radar/acceptance";

/**
 * decrypt.co covering Bank Leumi proved that host alone is the wrong measure.
 *
 * On 2026-08-26 the run's single usable gift was an item about an Israeli bank's crypto
 * launch, published by an international crypto outlet. `isIsraeliSource` reads the host,
 * so that item counted as zero Israeli coverage and the acceptance gate reported a
 * shortfall on the very item that worked.
 *
 * So there are two different questions, and they need two different measures:
 *   israeliSource  — did an Israeli PUBLISHER cover it? A health check on the locale fix.
 *   israelRelevant — is the item ABOUT the Israeli market or an Israeli company? The bar.
 */
const urls = (...u: string[]) => new Set(u);

describe("parseTriageResponse israelRelevant", () => {
  it("reads the flag the triage model sets for an item about an Israeli company", () => {
    const [v] = parseTriageResponse(
      JSON.stringify({
        verdicts: [
          { url: "https://decrypt.co/a", shareworthy: 0.9, stature: 0.9, kind: "big_news", israelRelevant: true },
        ],
      }),
      urls("https://decrypt.co/a")
    );
    expect(v.israelRelevant).toBe(true);
  });

  it("defaults to false when the model omits it, so a missing field never inflates the bar", () => {
    const [v] = parseTriageResponse(
      JSON.stringify({
        verdicts: [{ url: "https://reuters.com/b", shareworthy: 0.8, stature: 0.8, kind: "big_news" }],
      }),
      urls("https://reuters.com/b")
    );
    expect(v.israelRelevant).toBe(false);
  });
});

describe("judgeAcceptance", () => {
  const weighty = { kind: "big_news" as const, stature: 0.9 };

  it("counts an Israel-relevant item from a foreign host — the decrypt.co case", () => {
    const report = judgeAcceptance([
      { ...weighty, url: "https://decrypt.co/israel-leumi-bitcoin", israelRelevant: true },
      { ...weighty, url: "https://reuters.com/greece-banks", israelRelevant: false },
    ]);
    expect(report.israelRelevant).toBe(1);
    // No Israeli PUBLISHER appeared, and that is still worth knowing.
    expect(report.israeliSource).toBe(0);
    expect(report.met).toBe(true);
  });

  it("reports a shortfall when every item is foreign AND about a foreign market", () => {
    const report = judgeAcceptance([
      { ...weighty, url: "https://reuters.com/greece-banks", israelRelevant: false },
      { ...weighty, url: "https://reuters.com/india-sebi-ai", israelRelevant: false },
    ]);
    expect(report.met).toBe(false);
    expect(report.shortfall).toContain("ישראל");
  });

  it("still counts an Israeli publisher as Israel-relevant without the model saying so", () => {
    // globes.co.il writing about the Israeli market cannot be anything else, and the
    // gate must not depend on the model remembering to set a flag.
    const report = judgeAcceptance([
      { ...weighty, url: "https://www.globes.co.il/news/article.aspx?did=1", israelRelevant: false },
      { ...weighty, url: "https://reuters.com/x", israelRelevant: false },
    ]);
    expect(report.israeliSource).toBe(1);
    expect(report.israelRelevant).toBe(1);
    expect(report.met).toBe(true);
  });
});
