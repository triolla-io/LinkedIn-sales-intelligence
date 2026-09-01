/**
 * Task 4 of the v3 Phase B flow: triage classifies each item into the industry
 * pack's CLOSED taxonomy.
 *
 * The closedness IS the feature. Free tagging on both sides is what `fit.ts`'s text
 * overlap already does, and it fails silently on synonyms — "אשראי-צרכני" on the item
 * and "consumer credit" on the person never meet. So the model may only choose from a
 * list it is handed, and anything it invents is DROPPED rather than mapped onto the
 * nearest member: a coerced tag is a match nobody can trace back to a real judgement,
 * which is the same reason `asKind` sends an unknown kind to "other" instead of
 * guessing.
 *
 * No real LLM call anywhere in this file — openrouterChat is mocked. There is a live
 * daily budget on that path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRIAGE_CHUNK_SIZE } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { parseTriageResponse, triageChunk, triageAll, MAX_INDUSTRY_TAGS_PER_ITEM } = await import(
  "@/lib/tech-radar/triage"
);

/** A slice of the seeded banking/fintech taxonomy (Task 1's `taxonomy` shape). */
const TAXONOMY = [
  { tag: "אשראי-צרכני", label: "אשראי צרכני" },
  { tag: "משכנתאות", label: "משכנתאות" },
  { tag: "תשלומים", label: "תשלומים" },
  { tag: "KYC-ואימות", label: "KYC ואימות זהות" },
  { tag: "רגולציה-ישראל", label: "רגולציה ישראלית" },
  { tag: "שוקי-הון", label: "שוקי הון" },
] as const;

const URL1 = "https://globes.co.il/news/article-1";
const valid = new Set([URL1]);

function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}
function item(n: number) {
  return { title: `t${n}`, url: `https://x.com/${n}`, snippet: "s", publishedAt: null };
}
/** A full, well-formed verdict except for the industryTags under test. */
function verdict(tags: unknown, url = URL1) {
  return JSON.stringify({
    verdicts: [
      {
        url,
        shareworthy: 0.8,
        stature: 0.7,
        kind: "big_news",
        publisher: "globes.co.il",
        staleness: false,
        israelRelevant: true,
        categories: ["Consumer Credit"],
        vendor: "Bank Hapoalim",
        technology: null,
        industryTags: tags,
      },
    ],
  });
}

beforeEach(() => chat.mockReset());

describe("parseTriageResponse industryTags", () => {
  it("keeps only tags that are members of the taxonomy it was handed", () => {
    const [v] = parseTriageResponse(verdict(["אשראי-צרכני", "משכנתאות"]), valid, TAXONOMY);
    expect(v.industryTags).toEqual(["אשראי-צרכני", "משכנתאות"]);
  });

  /**
   * The whole point of a closed list. An invented tag is dropped, not snapped onto the
   * nearest member: "אשראי" is not "אשראי-צרכני", and a coerced tag would put an item
   * in front of a person on a judgement the model never made.
   */
  it("drops an off-list tag instead of coercing it to a neighbour", () => {
    const [v] = parseTriageResponse(
      verdict(["אשראי-צרכני", "crypto-moon", "אשראי", "core banking"]),
      valid,
      TAXONOMY
    );
    expect(v.industryTags).toEqual(["אשראי-צרכני"]);
  });

  /** A label is not a tag. The person side subscribes by `tag`, so a label would
   *  match nobody — recording it would look like a hit and behave like a miss. */
  it("does not accept a taxonomy label in place of its tag", () => {
    const [v] = parseTriageResponse(verdict(["KYC ואימות זהות"]), valid, TAXONOMY);
    expect(v.industryTags).toEqual([]);
  });

  /** No tag matched is a legitimate answer, and it must not cost the item its scores:
   *  the company-outward path in fit.ts still reads the same verdict. */
  it("keeps the scores and the categories when nothing matched", () => {
    const [v] = parseTriageResponse(verdict(["nothing", "at", "all"]), valid, TAXONOMY);
    expect(v.industryTags).toEqual([]);
    expect(v.shareworthy).toBe(0.8);
    expect(v.stature).toBe(0.7);
    expect(v.kind).toBe("big_news");
    expect(v.categories).toEqual(["consumer credit"]);
  });

  it("treats a missing industryTags key as no tags, never as a failure", () => {
    const [v] = parseTriageResponse(
      '{"verdicts":[{"url":"' + URL1 + '","shareworthy":0.7,"stature":0.6,"kind":"research"}]}',
      valid,
      TAXONOMY
    );
    expect(v.industryTags).toEqual([]);
    expect(v.shareworthy).toBe(0.7);
  });

  it("canonicalises to the taxonomy's own spelling and dedupes", () => {
    const [v] = parseTriageResponse(
      verdict(["  kyc-ואימות  ", "KYC-ואימות", "תשלומים"]),
      valid,
      TAXONOMY
    );
    expect(v.industryTags).toEqual(["KYC-ואימות", "תשלומים"]);
  });

  it("ignores non-string entries without losing the good ones", () => {
    const [v] = parseTriageResponse(verdict([null, 7, {}, "תשלומים"]), valid, TAXONOMY);
    expect(v.industryTags).toEqual(["תשלומים"]);
  });

  it("survives industryTags arriving as a string instead of an array", () => {
    const [v] = parseTriageResponse(verdict("תשלומים"), valid, TAXONOMY);
    expect(v.industryTags).toEqual([]);
  });

  /**
   * A model that sprays every tag it recognises would make every item a broad-tier
   * candidate for everyone — Task 6's floor asks for >=2 broad tags, so 20 tags per
   * item removes the floor entirely. The cap keeps the model's own first choices.
   */
  it("caps the number of tags per item", () => {
    const many = TAXONOMY.map((t) => t.tag);
    const [v] = parseTriageResponse(verdict(many), valid, TAXONOMY);
    expect(MAX_INDUSTRY_TAGS_PER_ITEM).toBeLessThan(many.length);
    expect(v.industryTags).toHaveLength(MAX_INDUSTRY_TAGS_PER_ITEM);
    expect(v.industryTags).toEqual(many.slice(0, MAX_INDUSTRY_TAGS_PER_ITEM));
  });

  /**
   * The company-outward path (scan.ts -> fit.ts) triages without a pack. Absent is
   * NOT the same as []: [] means "a taxonomy was offered and nothing matched", which
   * is the row a future threshold calibration reads. A run with no pack must not look
   * like a run where every item missed.
   */
  it("omits the field entirely when no taxonomy was supplied", () => {
    const [v] = parseTriageResponse(verdict(["אשראי-צרכני"]), valid);
    expect(v.industryTags).toBeUndefined();
    expect("industryTags" in v).toBe(false);
    expect(v.shareworthy).toBe(0.8);
  });

  it("yields no tags for an empty taxonomy rather than accepting anything", () => {
    const [v] = parseTriageResponse(verdict(["אשראי-צרכני"]), valid, []);
    expect(v.industryTags).toEqual([]);
  });
});

describe("triageChunk taxonomy prompt", () => {
  it("hands the model the closed list, tag and label, and names it closed", async () => {
    chat.mockResolvedValue(ok(verdict(["תשלומים"], "https://x.com/1")));
    await triageChunk([item(1)], TAXONOMY);

    const body = chat.mock.calls[0][1] as { messages: { role: string; content: string }[] };
    const user = body.messages.find((m) => m.role === "user")!.content;
    for (const t of TAXONOMY) {
      expect(user).toContain(t.tag);
      expect(user).toContain(t.label);
    }
    expect(user).toMatch(/CLOSED/);
    // The instruction that makes an off-list tag pointless for the model to produce.
    expect(user).toMatch(/industryTags/);
  });

  /** Unchanged prompt on the company path: no taxonomy block, no new field asked for,
   *  so the existing behaviour and its cost are untouched. */
  it("adds nothing to the prompt when there is no taxonomy", async () => {
    chat.mockResolvedValue(ok(verdict([], "https://x.com/1")));
    await triageChunk([item(1)]);
    const body = chat.mock.calls[0][1] as { messages: { role: string; content: string }[] };
    const user = body.messages.find((m) => m.role === "user")!.content;
    expect(user).not.toMatch(/TAXONOMY/);
    expect(user).not.toMatch(/industryTags/);
  });

  /**
   * A truncated chunk costs the whole chunk — the 2026-08 live run came back
   * finish_reason="length" and 25 verdicts parsed to zero. industryTags adds a fourth
   * array field per verdict, so the per-item output budget has to grow with it.
   */
  it("budgets output tokens for the added field", async () => {
    chat.mockResolvedValue(ok(verdict([], "https://x.com/1")));
    const chunk = Array.from({ length: TRIAGE_CHUNK_SIZE }, (_, i) => item(i));
    await triageChunk(chunk, TAXONOMY);
    const { max_tokens } = chat.mock.calls[0][1] as { max_tokens: number };
    expect(max_tokens).toBeGreaterThan(TRIAGE_CHUNK_SIZE * 270);
  });

  it("passes the taxonomy through to every chunk of a pool", async () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i));
    chat.mockImplementation(async () => ok(JSON.stringify({ verdicts: [] })));
    await triageAll(items, TAXONOMY);
    expect(chat).toHaveBeenCalledTimes(2);
    for (const call of chat.mock.calls) {
      const body = call[1] as { messages: { role: string; content: string }[] };
      const user = body.messages.find((m) => m.role === "user")!.content;
      expect(user).toContain("רגולציה-ישראל");
    }
  });

  it("tags the verdicts it returns from a live chunk", async () => {
    chat.mockResolvedValue(ok(verdict(["תשלומים", "off-list"], "https://x.com/1")));
    const out = await triageChunk([item(1)], TAXONOMY);
    expect(out).toHaveLength(1);
    expect(out[0].industryTags).toEqual(["תשלומים"]);
  });
});
