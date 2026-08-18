import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_RECIPIENTS_PER_OPPORTUNITY, type RecipientCandidate } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { buildRecipientWhere, parseRankResponse, rankRecipients } = await import(
  "@/lib/tech-radar/recipients"
);

const item = { technology: "Fraud Shield", title: "Acme launches Fraud Shield", summary: "Scores transactions." };

function candidate(id: string, title = "VP Payments"): RecipientCandidate {
  return { contactId: id, fullName: `Person ${id}`, hebrewFirstName: null, currentTitle: title, headline: null };
}
function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}

beforeEach(() => chat.mockReset());

describe("buildRecipientWhere", () => {
  it("uses the resolved company link when present", () => {
    const where = buildRecipientWhere("owner1", { companyId: "co1", name: "בנק הפועלים" });
    expect(where.companyId).toBe("co1");
    expect(where.currentCompany).toBeUndefined();
  });

  it("falls back to a case-insensitive name match when unresolved", () => {
    const where = buildRecipientWhere("owner1", { companyId: null, name: "בנק הפועלים" });
    expect(where.currentCompany).toEqual({ contains: "בנק הפועלים", mode: "insensitive" });
    expect(where.companyId).toBeUndefined();
  });

  it("always scopes to the owner and excludes removed contacts", () => {
    const where = buildRecipientWhere("owner1", { companyId: "co1", name: "x" });
    expect(where.ownerId).toBe("owner1");
    expect(where.removedAt).toBeNull();
  });

  it("includes the senior-title clause", () => {
    const where = buildRecipientWhere("owner1", { companyId: "co1", name: "x" }) as { OR?: unknown[] };
    expect(Array.isArray(where.OR)).toBe(true);
    expect((where.OR ?? []).length).toBeGreaterThan(5);
  });
});

describe("parseRankResponse", () => {
  const valid = new Set(["a", "b"]);

  it("parses a fenced response", () => {
    const out = parseRankResponse('```json\n{"recipients":[{"contactId":"a","score":0.9,"reason":"אחראי תשלומים"}]}\n```', valid);
    expect(out).toEqual([{ contactId: "a", score: 0.9, reason: "אחראי תשלומים" }]);
  });

  // A hallucinated id would create a draft aimed at nobody.
  it("drops contact ids that were never offered", () => {
    const out = parseRankResponse('{"recipients":[{"contactId":"ghost","score":1,"reason":"x"},{"contactId":"a","score":0.5,"reason":"y"}]}', valid);
    expect(out.map((r) => r.contactId)).toEqual(["a"]);
  });

  it("drops entries with no reason", () => {
    expect(parseRankResponse('{"recipients":[{"contactId":"a","score":1,"reason":"  "}]}', valid)).toEqual([]);
  });

  it("dedupes repeated ids and clamps scores", () => {
    const out = parseRankResponse('{"recipients":[{"contactId":"a","score":5,"reason":"x"},{"contactId":"a","score":0.1,"reason":"y"}]}', valid);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(1);
  });

  it("recovers from truncated JSON", () => {
    const out = parseRankResponse('{"recipients":[{"contactId":"a","score":0.8,"reason":"ok"},{"contactId":"b","sco', valid);
    expect(out.map((r) => r.contactId)).toEqual(["a"]);
  });

  it("returns empty on prose", () => {
    expect(parseRankResponse("no", valid)).toEqual([]);
  });
});

describe("rankRecipients", () => {
  it("makes no LLM call when there are no candidates", async () => {
    expect(await rankRecipients(item, [])).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("sorts by score descending", async () => {
    chat.mockResolvedValue(
      ok('{"recipients":[{"contactId":"a","score":0.3,"reason":"x"},{"contactId":"b","score":0.9,"reason":"y"}]}')
    );
    const out = await rankRecipients(item, [candidate("a"), candidate("b")]);
    expect(out.map((r) => r.contactId)).toEqual(["b", "a"]);
  });

  it("caps the fan-out per opportunity", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    chat.mockResolvedValue(
      ok(JSON.stringify({ recipients: ids.map((id, n) => ({ contactId: id, score: 1 - n / 10, reason: "r" })) }))
    );
    const out = await rankRecipients(item, ids.map((id) => candidate(id)));
    expect(out).toHaveLength(MAX_RECIPIENTS_PER_OPPORTUNITY);
    expect(MAX_RECIPIENTS_PER_OPPORTUNITY).toBe(3);
  });

  it("is tagged for cost attribution", async () => {
    chat.mockResolvedValue(ok('{"recipients":[]}'));
    await rankRecipients(item, [candidate("a")]);
    expect(chat.mock.calls[0][0]).toBe("tech-radar-recipients");
  });

  it("throws on a failed HTTP call", async () => {
    chat.mockResolvedValue({ ok: false, status: 500, data: {} });
    await expect(rankRecipients(item, [candidate("a")])).rejects.toThrow(/HTTP 500/);
  });
});
