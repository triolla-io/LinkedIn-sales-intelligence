import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRIAGE_CHUNK_SIZE } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { parseTriageResponse, triageChunk, triageAll } = await import("@/lib/tech-radar/triage");

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
      '```json\n{"verdicts":[{"url":"https://x.com/1","isLaunch":true,"categories":["Fraud Detection"],"vendor":"Acme","technology":"Shield"}]}\n```',
      valid
    );
    expect(out).toEqual([
      { url: "https://x.com/1", isLaunch: true, categories: ["fraud detection"], vendor: "Acme", technology: "Shield" },
    ]);
  });

  // The model inventing rows is a real failure mode.
  it("drops hallucinated urls that were never sent", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://evil.com/made-up","isLaunch":true},{"url":"https://x.com/1","isLaunch":true}]}',
      valid
    );
    expect(out.map((v) => v.url)).toEqual(["https://x.com/1"]);
  });

  it("dedupes repeated urls", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://x.com/1","isLaunch":true},{"url":"https://x.com/1","isLaunch":false}]}',
      valid
    );
    expect(out).toHaveLength(1);
    expect(out[0].isLaunch).toBe(true);
  });

  it("coerces a non-boolean isLaunch to false", () => {
    const out = parseTriageResponse('{"verdicts":[{"url":"https://x.com/1","isLaunch":"yes"}]}', valid);
    expect(out[0].isLaunch).toBe(false);
  });

  it("normalizes categories and drops junk entries", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://x.com/1","isLaunch":true,"categories":["  Payments  ","payments",5,null,""]}]}',
      valid
    );
    expect(out[0].categories).toEqual(["payments"]);
  });

  it("recovers verdicts from truncated JSON", () => {
    const out = parseTriageResponse(
      '{"verdicts":[{"url":"https://x.com/1","isLaunch":true,"categories":[]},{"url":"https://x.com/2","isLau',
      new Set(["https://x.com/1", "https://x.com/2"])
    );
    expect(out.map((v) => v.url)).toEqual(["https://x.com/1"]);
  });

  it("returns empty on prose", () => {
    expect(parseTriageResponse("I can't do that", valid)).toEqual([]);
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
