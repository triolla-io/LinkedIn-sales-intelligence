import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRIAGE_CHUNK_SIZE } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { parseTriageResponse, triageChunk, triageAll, SYSTEM } = await import("@/lib/tech-radar/triage");

function item(n: number) {
  return { title: `t${n}`, url: `https://x.com/${n}`, snippet: "s", publishedAt: null };
}
function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}
function verdictsFor(items: { url: string }[]) {
  return ok(
    JSON.stringify({
      verdicts: items.map((i) => ({
        url: i.url,
        isLaunch: true,
        categories: ["Payments"],
        vendor: "Acme",
        technology: "Thing",
      })),
    })
  );
}

beforeEach(() => chat.mockReset());

describe("parseTriageResponse", () => {
  const valid = new Set(["https://x.com/1"]);

  it("parses a fenced response", () => {
    const out = parseTriageResponse(
      '```json\n{"verdicts":[{"url":"https://x.com/1","shareworthy":0.8,"stature":0.7,"kind":"research","publisher":"report.org","staleness":false,"categories":["Fraud Detection"],"vendor":"Acme","technology":"Shield"}]}\n```',
      valid
    );
    expect(out).toEqual([
      {
        url: "https://x.com/1",
        shareworthy: 0.8,
        stature: 0.7,
        kind: "research",
        publisher: "report.org",
        staleness: false,
        categories: ["fraud detection"],
        vendor: "Acme",
        technology: "Shield",
      },
    ]);
  });

  /**
   * A model answering "very high", or 8 instead of 0.8, must not become a top hit.
   * Everything untrustworthy clamps to 0 — the safe end: an unscored item skipped is
   * recoverable, an unscored item sent is not.
   */
  it("clamps a score it cannot trust to zero", () => {
    for (const bad of ['"very high"', "8", "-1", "null", "true", '"0.8"']) {
      const out = parseTriageResponse(
        `{"verdicts":[{"url":"https://x.com/1","shareworthy":${bad},"kind":"research"}]}`,
        valid
      );
      expect(out[0].shareworthy, `input ${bad}`).toBe(0);
    }
  });

  it("keeps the boundary scores exactly", () => {
    for (const [raw, expected] of [["1", 1], ["0", 0], ["0.6", 0.6]] as const) {
      const out = parseTriageResponse(
        `{"verdicts":[{"url":"https://x.com/1","shareworthy":${raw},"kind":"trend"}]}`,
        valid
      );
      expect(out[0].shareworthy).toBe(expected);
    }
  });

  /** An unrecognised kind lands on "other", never on a kind that carries a policy. */
  it("maps an unknown or missing kind to other", () => {
    for (const raw of ['"exciting"', "null", "5", '""']) {
      const out = parseTriageResponse(
        `{"verdicts":[{"url":"https://x.com/1","shareworthy":0.9,"kind":${raw}}]}`,
        valid
      );
      expect(out[0].kind, `input ${raw}`).toBe("other");
    }
  });

  it("accepts a kind in any casing", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://x.com/1","shareworthy":0.9,"kind":" Vendor_Launch "}]}',
      valid
    );
    expect(out[0].kind).toBe("vendor_launch");
  });

  it("defaults staleness to false rather than dropping the item", () => {
    const out = parseTriageResponse('{"verdicts":[{"url":"https://x.com/1","shareworthy":0.9,"kind":"trend"}]}', valid);
    expect(out[0].staleness).toBe(false);
    expect(out[0].publisher).toBeNull();
  });

  // The model inventing rows is a real failure mode.
  it("drops hallucinated urls that were never sent", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://evil.com/made-up","shareworthy":0.9,"kind":"research"},{"url":"https://x.com/1","shareworthy":0.9,"kind":"research"}]}',
      valid
    );
    expect(out.map((v) => v.url)).toEqual(["https://x.com/1"]);
  });

  it("dedupes repeated urls, keeping the first verdict", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://x.com/1","shareworthy":0.9,"kind":"research"},{"url":"https://x.com/1","shareworthy":0.1,"kind":"other"}]}',
      valid
    );
    expect(out).toHaveLength(1);
    expect(out[0].shareworthy).toBe(0.9);
  });

  it("normalizes categories and drops junk entries", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://x.com/1","shareworthy":0.9,"kind":"research","categories":["  Payments  ","payments",5,null,""]}]}',
      valid
    );
    expect(out[0].categories).toEqual(["payments"]);
  });
});

/**
 * The prompt is the filter. These pin the inversion itself, so a future edit cannot
 * quietly restore the launch-hunting behaviour that produced eleven vendor launches
 * and nothing else on 2026-08-20.
 */
describe("the triage prompt", () => {
  it("asks whether a person would forward it, not whether it is new", () => {
    expect(SYSTEM).toMatch(/FORWARDING|forward/);
    expect(SYSTEM).toMatch(/nothing to gain|no agenda/);
  });

  it("scores a vendor announcing its own product LOW, even when genuinely new", () => {
    expect(SYSTEM).toMatch(/EVEN IF the technology is genuinely useful and genuinely new/);
  });

  it("names publisher-versus-vendor as the decisive signal", () => {
    expect(SYSTEM).toMatch(/publisher.*vendor|vendor.*publisher/i);
    expect(SYSTEM).toMatch(/PROMOTION until proven otherwise/);
  });

  it("rewards research, trends and big news", () => {
    expect(SYSTEM).toMatch(/research, reports and surveys/);
    expect(SYSTEM).toMatch(/genuine trend/);
  });

  /** The old prompt listed these as reasons to REJECT an item. */
  it("no longer rejects research and analysis outright", () => {
    expect(SYSTEM).not.toMatch(/isLaunch=false for everything else/);
    expect(SYSTEM).not.toMatch(/market analysis, forecasts, surveys, research reports/);
  });

  it("demands decimals, because a word would clamp to zero", () => {
    expect(SYSTEM).toMatch(/both as DECIMALS/);
    expect(SYSTEM).toMatch(/Never a word/);
  });

  /**
   * Relevance and weight are different questions. The 2026-08-23 run passed a paper on
   * a CO2 injection polymer and a trade piece on a pipe robot — squarely on topic, no
   * gift in either.
   */
  it("scores weight separately, with the CEO-to-CEO test", () => {
    expect(SYSTEM).toMatch(/WOULD A CEO FORWARD THIS TO ANOTHER CEO/);
    expect(SYSTEM).toMatch(/McKinsey, BCG, Deloitte/);
    expect(SYSTEM).toMatch(/one niche tool, method or instrument in a trade publication/);
  });

  it("carries the on-topic-but-weightless case as a worked example", () => {
    expect(SYSTEM).toMatch(/stature 0\.2\. Correct subject for an asset manager/);
    expect(SYSTEM).toMatch(/ועדת הריכוזיות/);
  });

  it("carries both directions of the same subject as a worked example", () => {
    expect(SYSTEM).toContain("aws.amazon.com");
    expect(SYSTEM).toMatch(/vendor_launch", shareworthy 0\.2|shareworthy 0\.2/);
    expect(SYSTEM).toMatch(/research", shareworthy 0\.8|shareworthy 0\.8/);
  });
});


describe("triageChunk", () => {
  it("makes no call for an empty chunk", async () => {
    expect(await triageChunk([])).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("is tagged for cost attribution", async () => {
    chat.mockResolvedValue(verdictsFor([item(1)]));
    await triageChunk([item(1)]);
    expect(chat.mock.calls[0][0]).toBe("tech-radar-triage");
  });

  it("throws on a failed HTTP call", async () => {
    chat.mockResolvedValue({ ok: false, status: 500, data: {} });
    await expect(triageChunk([item(1)])).rejects.toThrow(/HTTP 500/);
  });

  /**
   * A flat max_tokens of 1800 was not enough for a full 25-item chunk: the live run came
   * back finish_reason="length", cut off mid-verdict, and the whole chunk parsed to zero.
   * The output budget has to scale with the number of items being judged.
   */
  it("scales the output budget with the chunk size", async () => {
    chat.mockResolvedValue(verdictsFor([item(1)]));
    await triageChunk([item(1)]);
    const small = (chat.mock.calls[0][1] as { max_tokens: number }).max_tokens;

    chat.mockReset();
    chat.mockResolvedValue(verdictsFor([]));
    await triageChunk(Array.from({ length: TRIAGE_CHUNK_SIZE }, (_, i) => item(i)));
    const large = (chat.mock.calls[0][1] as { max_tokens: number }).max_tokens;

    expect(large).toBeGreaterThan(small);
    // Comfortably above the ~70 output tokens each verdict actually costs.
    expect(large).toBeGreaterThan(TRIAGE_CHUNK_SIZE * 100);
  });
});

describe("triageAll", () => {
  // A single call over ~100 items truncates its JSON and silently returns zero.
  it("chunks a 60-item pool into 25/25/10 and merges every verdict", async () => {
    const items = Array.from({ length: 60 }, (_, i) => item(i));
    // Answer per chunk index: 0-24, 25-49, 50-59.
    let call = 0;
    chat.mockImplementation(async () => {
      const slice = items.slice(call * TRIAGE_CHUNK_SIZE, (call + 1) * TRIAGE_CHUNK_SIZE);
      call += 1;
      return verdictsFor(slice);
    });
    const out = await triageAll(items);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(TRIAGE_CHUNK_SIZE).toBe(25);
    expect(out).toHaveLength(60);
    expect(new Set(out.map((v) => v.url)).size).toBe(60);
  });

  // Losing 25 verdicts beats losing all 150.
  it("keeps the other chunks when one chunk fails", async () => {
    const items = Array.from({ length: 50 }, (_, i) => item(i));
    let call = 0;
    chat.mockImplementation(async () => {
      const index = call;
      call += 1;
      if (index === 0) throw new Error("chunk blew up");
      return verdictsFor(items.slice(index * TRIAGE_CHUNK_SIZE, (index + 1) * TRIAGE_CHUNK_SIZE));
    });
    const out = await triageAll(items);
    // The first 25 are lost, the second 25 survive — better than losing all 50.
    expect(out).toHaveLength(25);
    expect(out.map((v) => v.url)).toContain("https://x.com/25");
  });

  it("returns empty for an empty pool without calling out", async () => {
    expect(await triageAll([])).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });
});
