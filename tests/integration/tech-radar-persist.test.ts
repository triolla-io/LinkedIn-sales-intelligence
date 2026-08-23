import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TechItemDraft } from "@/lib/tech-radar/types";

const itemFindUnique = vi.fn();
const itemFindMany = vi.fn();
const itemCreate = vi.fn();
const itemUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    techItem: {
      findUnique: (...a: unknown[]) => itemFindUnique(...a),
      findMany: (...a: unknown[]) => itemFindMany(...a),
      create: (...a: unknown[]) => itemCreate(...a),
      update: (...a: unknown[]) => itemUpdate(...a),
    },
  },
}));

const { upsertTechItem, interleaveByLine } = await import("@/lib/tech-radar/persist");

function draft(over: Partial<TechItemDraft> = {}): TechItemDraft {
  return {
    vendor: "ISO and GHG Protocol",
    technology: "Unified Corporate Carbon Accounting Standard",
    title: "ISO and GHG Protocol merge carbon accounting standards",
    summary: "s",
    categories: ["carbon accounting"],
    sources: [{ url: "https://esgtoday.com/a", title: "A", publishedAt: null }],
    publishedAt: null,
    thin: false, shareworthy: 0.8, stature: 0.7, kind: "research" as const,
    ...over,
  };
}

beforeEach(() => {
  for (const m of [itemFindUnique, itemFindMany, itemCreate, itemUpdate]) m.mockReset();
  itemFindUnique.mockResolvedValue(null);
  itemFindMany.mockResolvedValue([]);
  itemCreate.mockResolvedValue({ id: "new" });
});

describe("upsertTechItem", () => {
  it("creates the item when nothing matches", async () => {
    expect(await upsertTechItem(draft())).toBe("new");
    expect(itemCreate).toHaveBeenCalled();
  });

  it("reuses the item on an exact dedupe-key hit and merges new sources", async () => {
    itemFindUnique.mockResolvedValue({
      id: "existing",
      sources: [{ url: "https://other.com/x" }],
      thin: false,
    });
    expect(await upsertTechItem(draft())).toBe("existing");
    expect(itemCreate).not.toHaveBeenCalled();
    const merged = itemUpdate.mock.calls[0][0].data.sources as { url: string }[];
    expect(merged.map((s) => s.url)).toEqual(["https://other.com/x", "https://esgtoday.com/a"]);
  });

  /**
   * The live Delek run wrote the SAME announcement up twice from two outlets, as
   * "Unified Corporate Greenhouse Gas Accounting Standard" and "Unified Corporate
   * Carbon Accounting Standard", and the CEO received two near-identical messages.
   */
  it("reuses a near-identical item from the same parties", async () => {
    itemFindMany.mockResolvedValue([
      {
        id: "twin",
        vendor: "GHG Protocol and ISO",
        technology: "Unified Corporate Greenhouse Gas Accounting Standard",
        sources: [],
        thin: false,
      },
    ]);
    expect(await upsertTechItem(draft())).toBe("twin");
    expect(itemCreate).not.toHaveBeenCalled();
  });

  it("does not merge a different technology from the same vendor", async () => {
    itemFindMany.mockResolvedValue([
      { id: "other", vendor: "ISO and GHG Protocol", technology: "Water Stewardship Index", sources: [], thin: false },
    ]);
    expect(await upsertTechItem(draft())).toBe("new");
    expect(itemCreate).toHaveBeenCalled();
  });

  it("clears the thin flag once a real page has been read", async () => {
    itemFindUnique.mockResolvedValue({ id: "existing", sources: [], thin: true });
    await upsertTechItem(draft({ thin: false }));
    expect(itemUpdate.mock.calls[0][0].data.thin).toBe(false);
  });
});

/**
 * From the first scan a human ran: Delek's two energy opportunities got zero drafts
 * because the finance ones drafted first and spent every contact's message budget. The
 * business-line diversity was real in the feed and absent in the outreach.
 */
describe("interleaveByLine", () => {
  it("takes the best of each line in turn", () => {
    const rows = [
      { id: "fin1", businessLine: "financial services" },
      { id: "fin2", businessLine: "financial services" },
      { id: "fin3", businessLine: "financial services" },
      { id: "energy1", businessLine: "oil and gas" },
      { id: "energy2", businessLine: "oil and gas" },
    ];
    expect(interleaveByLine(rows)).toEqual(["fin1", "energy1", "fin2", "energy2", "fin3"]);
  });

  it("keeps every opportunity, just reorders them", () => {
    const rows = [
      { id: "a", businessLine: "x" },
      { id: "b", businessLine: "y" },
      { id: "c", businessLine: "x" },
    ];
    expect(interleaveByLine(rows).sort()).toEqual(["a", "b", "c"]);
  });

  it("preserves score order when every opportunity shares one line", () => {
    const rows = [
      { id: "first", businessLine: "one" },
      { id: "second", businessLine: "one" },
    ];
    expect(interleaveByLine(rows)).toEqual(["first", "second"]);
  });

  it("treats unattributed opportunities as a single bucket", () => {
    const rows = [
      { id: "n1", businessLine: null },
      { id: "n2", businessLine: "  " },
      { id: "line1", businessLine: "energy" },
    ];
    // The two unattributed ones must not each claim a turn ahead of the attributed line.
    expect(interleaveByLine(rows)).toEqual(["n1", "line1", "n2"]);
  });

  it("is case and whitespace insensitive about line names", () => {
    const rows = [
      { id: "a", businessLine: "Energy" },
      { id: "b", businessLine: " energy " },
      { id: "c", businessLine: "Finance" },
    ];
    expect(interleaveByLine(rows)).toEqual(["a", "c", "b"]);
  });

  it("handles an empty list", () => {
    expect(interleaveByLine([])).toEqual([]);
  });
});

/**
 * Story-level dedup. The 2026-08-23 run stored ONE Nature paper twice — once as
 * "CO2-EOR" and once as "CO2-EOR with xanthan gum" — because the dedupe key is built
 * from the model's own naming, and the model named the same article differently on two
 * passes. A url is not a matter of opinion.
 */
describe("normalizeStoryUrl", () => {
  it("treats the same article as the same story regardless of noise", async () => {
    const { normalizeStoryUrl } = await import("@/lib/tech-radar/persist");
    const canonical = normalizeStoryUrl("https://www.nature.com/articles/s41598-026-49640-7");
    for (const variant of [
      "http://nature.com/articles/s41598-026-49640-7",
      "https://www.nature.com/articles/s41598-026-49640-7/",
      "https://WWW.NATURE.COM/articles/S41598-026-49640-7",
    ]) {
      expect(normalizeStoryUrl(variant), variant).toBe(canonical);
    }
  });

  it("keeps two different articles apart", async () => {
    const { normalizeStoryUrl } = await import("@/lib/tech-radar/persist");
    expect(normalizeStoryUrl("https://nature.com/articles/a")).not.toBe(
      normalizeStoryUrl("https://nature.com/articles/b")
    );
  });

  it("does not throw on a malformed url", async () => {
    const { normalizeStoryUrl } = await import("@/lib/tech-radar/persist");
    expect(normalizeStoryUrl("  NOT a url ")).toBe("not a url");
  });
})
