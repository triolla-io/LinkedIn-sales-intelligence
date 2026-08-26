import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AxisMatch rows are created and never deleted, so judgeAndDraft's own query needs its
 * own freshness predicate — the ingest gate in freshness.ts only protects items on the
 * way IN. Without a date predicate on the `matches` where-clause, an item that was fresh
 * weeks ago stays a first-class candidate forever, including under `radar.judge`, which
 * runs this path with no gate of its own.
 *
 * The mock below filters `matches` the way Postgres actually would given the `where`
 * clause judgeAndDraft passes — so a missing predicate in the implementation leaves the
 * stale match in the result set, exactly as a missing `WHERE` would in production.
 */

const axisFindMany = vi.fn();
const draftFindMany = vi.fn();
const draftUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: { findMany: (...a: unknown[]) => axisFindMany(...a) },
    radarDraft: {
      findMany: (...a: unknown[]) => draftFindMany(...a),
      upsert: (...a: unknown[]) => draftUpsert(...a),
    },
  },
}));

const selectRecipientsForItem = vi.fn();
vi.mock("@/lib/tech-radar/veto", () => ({
  selectRecipientsForItem: (...a: unknown[]) => selectRecipientsForItem(...a),
}));

const draftTechMessage = vi.fn();
vi.mock("@/lib/tech-radar/draft", () => ({
  draftTechMessage: (...a: unknown[]) => draftTechMessage(...a),
}));

const { judgeAndDraft } = await import("@/lib/tech-radar/judge-and-draft");
const { FRESHNESS_WINDOW_DAYS } = await import("@/lib/tech-radar/freshness");

function contact(id: string) {
  return { id, ownerId: "owner1", fullName: `Person ${id}`, hebrewFirstName: null, currentTitle: "CEO", currentCompany: "Acme" };
}

function axisWithMatches(matches: { itemId: string; publishedAt: Date | null; title: string }[]) {
  return {
    id: "a1",
    label: "ציר",
    people: [
      {
        weight: 1,
        rationale: "r",
        personProfile: {
          roleLens: null,
          personalNotes: null,
          employerTrackedCompanyId: null,
          contact: contact("c1"),
        },
      },
    ],
    matches: matches.map((m) => ({
      score: 0.9,
      item: {
        id: m.itemId,
        title: m.title,
        summary: "s",
        technology: "tech",
        kind: "research",
        sources: [{ url: `https://news.com/${m.itemId}` }],
        publishedAt: m.publishedAt,
      },
    })),
  };
}

/** Simulates the DB-level filter a real `select: { matches: { where: {...} } }` applies. */
function applyMatchesFilter(axis: ReturnType<typeof axisWithMatches>, select: unknown) {
  const s = select as { matches?: { where?: { item?: { publishedAt?: { gte?: Date } } } } };
  const gte = s?.matches?.where?.item?.publishedAt?.gte;
  if (!gte) return axis; // no predicate passed — nothing filtered (the bug this test catches)
  return { ...axis, matches: axis.matches.filter((m) => (m.item.publishedAt ?? new Date(0)) >= gte) };
}

beforeEach(() => {
  for (const m of [axisFindMany, draftFindMany, draftUpsert, selectRecipientsForItem, draftTechMessage]) m.mockReset();
  draftFindMany.mockResolvedValue([]);
  draftUpsert.mockResolvedValue({});
  draftTechMessage.mockResolvedValue("היי, ראית את זה?\nתוכן.\nhttps://news.com/x");
});

describe("judgeAndDraft freshness predicate on AxisMatch", () => {
  it("a match against an item published 45 days ago produces no draft", async () => {
    const staleAt = new Date(Date.now() - 45 * 86_400_000);
    const axis = axisWithMatches([{ itemId: "stale1", publishedAt: staleAt, title: "old news" }]);
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue([
      {
        candidate: { contact: { contactId: "c1" }, axisId: "a1" },
        verdict: { outcome: "judged", whyHim: "why", adjustment: 0 },
        passed: true,
      },
    ]);

    const report = await judgeAndDraft("org1");

    expect(report.candidates).toBe(0);
    expect(report.drafted).toBe(0);
    expect(draftTechMessage).not.toHaveBeenCalled();
    expect(selectRecipientsForItem).not.toHaveBeenCalled();
  });

  it("still drafts a match against an item published inside the window", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = axisWithMatches([{ itemId: "fresh1", publishedAt: freshAt, title: "current news" }]);
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue([
      {
        candidate: { contact: { contactId: "c1" }, axisId: "a1" },
        verdict: { outcome: "judged", whyHim: "why", adjustment: 0 },
        passed: true,
      },
    ]);

    const report = await judgeAndDraft("org1");

    expect(report.candidates).toBe(1);
    expect(report.drafted).toBe(1);
    expect(draftTechMessage).toHaveBeenCalledTimes(1);
  });

  it("passes a matches where-clause gated on FRESHNESS_WINDOW_DAYS, not a separate constant", async () => {
    axisFindMany.mockResolvedValue([]);
    await judgeAndDraft("org1");
    const args = axisFindMany.mock.calls[0][0] as { select: { matches: { where: { item: { publishedAt: { gte: Date } } } } } };
    const gte = args.select.matches.where.item.publishedAt.gte;
    const expectedFloor = Date.now() - FRESHNESS_WINDOW_DAYS * 86_400_000;
    // Within a few seconds of the expected window edge — not brittle to exact millisecond timing.
    expect(Math.abs(gte.getTime() - expectedFloor)).toBeLessThan(5000);
  });
});
