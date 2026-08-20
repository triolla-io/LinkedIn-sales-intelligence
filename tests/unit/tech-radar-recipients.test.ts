import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_RECIPIENTS_PER_OPPORTUNITY, type RecipientCandidate } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { buildRecipientWhere, companyMatchWhere, parseRankResponse, rankRecipients } = await import(
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
    expect(where.OR).toContainEqual({ currentCompany: { contains: "בנק הפועלים", mode: "insensitive" } });
    expect(where.companyId).toBeUndefined();
  });

  /**
   * The live Delek Group run matched 1 contact of 7: the Head of Digital and the CIDO
   * — the two most relevant people for a technology conversation — write their employer
   * as "Delek" and "Delek US Holdings", so the canonical name alone missed them.
   */
  it("matches any of the company's aliases as well as its name", () => {
    const where = buildRecipientWhere("owner1", {
      companyId: null,
      name: "Delek Group",
      aliases: ["Delek", "Delek US Holdings"],
    });
    const clauses = where.OR as { currentCompany: { contains: string } }[];
    expect(clauses.map((c) => c.currentCompany.contains)).toEqual([
      "Delek Group",
      "Delek",
      "Delek US Holdings",
    ]);
  });

  it("ignores blank and duplicate aliases", () => {
    const where = buildRecipientWhere("owner1", {
      companyId: null,
      name: "Delek Group",
      aliases: ["  ", "Delek", "delek", "Delek Group"],
    });
    const clauses = where.OR as { currentCompany: { contains: string } }[];
    expect(clauses).toHaveLength(2);
  });

  // The resolved company link is exact, so aliases are not needed alongside it.
  it("prefers the company link and ignores aliases when it is present", () => {
    const where = buildRecipientWhere("owner1", {
      companyId: "co1",
      name: "Delek Group",
      aliases: ["Delek"],
    });
    expect(where.companyId).toBe("co1");
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

describe("companyMatchWhere", () => {
  /**
   * The whole reason this is split out: create-drafts needs "everyone at this
   * company" so a hand-marked contact who is NOT senior can still be drafted to.
   * If a seniority clause leaks back in here, marking a non-senior person silently
   * stops working and nothing else fails.
   */
  it("does NOT constrain the title, on the company-link branch", () => {
    const where = companyMatchWhere("owner1", { companyId: "co1", name: "בנק הפועלים" });
    expect(where.companyId).toBe("co1");
    expect(where.OR).toBeUndefined();
    expect(where.AND).toBeUndefined();
    expect(where.currentTitle).toBeUndefined();
  });

  it("does NOT constrain the title, on the name-matching branch", () => {
    const where = companyMatchWhere("owner1", { companyId: null, name: "Delek", aliases: ["Delek Group"] });
    // The OR present here is the company-name match, not a title match.
    expect(where.OR).toContainEqual({ currentCompany: { contains: "Delek", mode: "insensitive" } });
    expect(where.OR).toContainEqual({ currentCompany: { contains: "Delek Group", mode: "insensitive" } });
    expect(where.AND).toBeUndefined();
  });

  it("still scopes to the owner and excludes removed contacts", () => {
    const where = companyMatchWhere(["o1", "o2"], { companyId: null, name: "Acme" });
    expect(where.ownerId).toEqual({ in: ["o1", "o2"] });
    expect(where.removedAt).toBeNull();
  });
});

describe("buildRecipientWhere composition", () => {
  /**
   * seniorTitleWhere() emits its own OR. On the name-matching branch the base already
   * has one, so the seniority clause must be nested under AND — two sibling ORs would
   * overwrite each other and the seniority filter would vanish without any test failing.
   * These two cases pin that the nesting differs by branch, on purpose.
   */
  it("nests seniority under AND when the base already has an OR", () => {
    const where = buildRecipientWhere("owner1", { companyId: null, name: "Acme" });
    expect(where.OR).toContainEqual({ currentCompany: { contains: "Acme", mode: "insensitive" } });
    expect(Array.isArray(where.AND)).toBe(true);
    expect(where.AND).toHaveLength(1);
  });

  it("spreads seniority when the base has no OR to collide with", () => {
    const where = buildRecipientWhere("owner1", { companyId: "co1", name: "Acme" });
    expect(where.companyId).toBe("co1");
    expect(where.AND).toBeUndefined();
    // The seniority clause itself is the OR on this branch.
    expect(where.OR).toBeDefined();
  });

  it("keeps a seniority constraint on both branches", () => {
    const linked = buildRecipientWhere("owner1", { companyId: "co1", name: "Acme" });
    const byName = buildRecipientWhere("owner1", { companyId: null, name: "Acme" });
    expect(JSON.stringify(linked)).toMatch(/currentTitle/);
    expect(JSON.stringify(byName)).toMatch(/currentTitle/);
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
