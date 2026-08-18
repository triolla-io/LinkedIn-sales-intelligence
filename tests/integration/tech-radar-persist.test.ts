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

const { upsertTechItem } = await import("@/lib/tech-radar/persist");

function draft(over: Partial<TechItemDraft> = {}): TechItemDraft {
  return {
    vendor: "ISO and GHG Protocol",
    technology: "Unified Corporate Carbon Accounting Standard",
    title: "ISO and GHG Protocol merge carbon accounting standards",
    summary: "s",
    categories: ["carbon accounting"],
    sources: [{ url: "https://esgtoday.com/a", title: "A", publishedAt: null }],
    publishedAt: null,
    thin: false,
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
