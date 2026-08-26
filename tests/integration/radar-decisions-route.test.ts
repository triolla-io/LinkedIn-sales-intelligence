import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The calibration screen's payload. The load-bearing property: it shows what STOPPED,
 * not only what passed — a gate that rejects everything looks identical to a working
 * one if you can only see survivors.
 */

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      h(req, { effectiveUserId: "owner1", user: { name: "אריאל" }, org: { id: "org1" } }),
}));

const profileFindMany = vi.fn();
const matchFindMany = vi.fn();
const draftFindMany = vi.fn();
const scanRunFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findMany: (...a: unknown[]) => profileFindMany(...a) },
    axisMatch: { findMany: (...a: unknown[]) => matchFindMany(...a) },
    radarDraft: { findMany: (...a: unknown[]) => draftFindMany(...a) },
    radarScanRun: { findFirst: (...a: unknown[]) => scanRunFindFirst(...a) },
  },
}));

const { GET } = await import("@/app/api/radar/decisions/route");
const req = { nextUrl: { pathname: "/api/radar/decisions" } } as unknown as NextRequest;

const CANON = "https://ethanolproducer.com/articles/epa-rvo-2026";

function profile(over: Record<string, unknown> = {}) {
  return {
    contact: { id: "ct1", fullName: "Avigal Soreq" },
    axes: [{ mutedAt: null, axis: { id: "ax1", label: "חבות RIN" } }],
    ...over,
  };
}

function match(over: Record<string, unknown> = {}) {
  return {
    axisId: "ax1",
    score: 0.8,
    rationale: "EPA ↔ יעדי התפוקה",
    item: {
      id: "it1",
      title: "EPA finalizes RVOs",
      thin: false,
      shareworthy: 0.9,
      stature: 0.8,
      kind: "big_news",
      sources: [{ url: CANON, title: "t" }],
    },
    ...over,
  };
}

beforeEach(() => {
  for (const m of [profileFindMany, matchFindMany, draftFindMany, scanRunFindFirst]) m.mockReset();
  profileFindMany.mockResolvedValue([profile()]);
  matchFindMany.mockResolvedValue([match()]);
  draftFindMany.mockResolvedValue([]);
  scanRunFindFirst.mockResolvedValue(null);
});

describe("GET /api/radar/decisions", () => {
  it("scopes the person model to the signed-in owner", async () => {
    await GET(req);
    expect(JSON.stringify(profileFindMany.mock.calls[0][0].where)).toContain("owner1");
  });

  it("shows an item that connected but produced no draft — the interesting middle", async () => {
    const body = await ((await GET(req)) as Response).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].journey.steps.find((s: { key: string }) => s.key === "connection").state).toBe("pass");
    expect(body.items[0].journey.steps.find((s: { key: string }) => s.key === "draft").state).not.toBe("pass");
  });

  it("a rejected candidate is overridable and carries its draft id", async () => {
    draftFindMany.mockResolvedValue([
      {
        id: "d1", contactId: "ct1", axisId: "ax1", itemId: "it1", status: "VETOED",
        whyHim: null, discardReason: "תחזית מאקרו שנכונה לכל מנהל בענף",
      },
    ]);
    const body = await ((await GET(req)) as Response).json();
    expect(body.items[0].journey.overridable).toBe(true);
    expect(body.items[0].draftId).toBe("d1");
    expect(body.items[0].journey.verdict.text).toContain("מאקרו");
  });

  it("an accepted draft reads as good, and is not overridable", async () => {
    draftFindMany.mockResolvedValue([
      {
        id: "d2", contactId: "ct1", axisId: "ax1", itemId: "it1", status: "PENDING_REVIEW",
        whyHim: "זו החלטה שלו", discardReason: null,
      },
    ]);
    const body = await ((await GET(req)) as Response).json();
    expect(body.items[0].journey.verdict.tone).toBe("good");
    expect(body.items[0].draftId).toBeNull();
  });

  it("marks a snippet-only item so it can be filtered and seen", async () => {
    matchFindMany.mockResolvedValue([match({ item: { ...match().item, thin: true } })]);
    const body = await ((await GET(req)) as Response).json();
    expect(body.items[0].snippetOnly).toBe(true);
    expect(body.items[0].journey.steps[0].state).toBe("fail");
  });

  it("run is null with no finished scan — an explained empty state, not zeros", async () => {
    const body = await ((await GET(req)) as Response).json();
    expect(body.run).toBeNull();
    expect(body.quietAxes).toEqual([]);
  });

  it("quiet axes come from the recorded run, never invented", async () => {
    scanRunFindFirst.mockResolvedValue({
      scanned: 677, topical: 54, important: 12, connected: 6, drafts: 2,
      finishedAt: new Date("2026-08-24T06:00:00Z"),
      axisStats: [
        { axisId: "ax9", label: "מונטיזציה", queries: 6, results: 0, hebrewNoIsraeliSource: false },
        { axisId: "ax1", label: "חבות RIN", queries: 3, results: 4, hebrewNoIsraeliSource: false },
      ],
    });
    const body = await ((await GET(req)) as Response).json();
    expect(body.run.scanned).toBe(677);
    // Only the silent ones belong in that section.
    expect(body.quietAxes.map((a: { label: string }) => a.label)).toEqual(["מונטיזציה"]);
  });

  it("surfaces staleDropped/undatedDropped from the run's persisted report, so a stale week can say so", async () => {
    scanRunFindFirst.mockResolvedValue({
      scanned: 40, topical: 0, important: 0, connected: 0, drafts: 0,
      finishedAt: new Date("2026-08-24T06:00:00Z"),
      axisStats: [{ axisId: "ax1", label: "חבות RIN", queries: 3, results: 0, hebrewNoIsraeliSource: false }],
      report: { staleDropped: 12, undatedDropped: 5 },
    });
    const body = await ((await GET(req)) as Response).json();
    expect(body.run.staleDropped).toBe(12);
    expect(body.run.undatedDropped).toBe(5);
  });

  it("defaults staleDropped/undatedDropped to 0 when the run predates the freshness report fields", async () => {
    scanRunFindFirst.mockResolvedValue({
      scanned: 5, topical: 1, important: 1, connected: 1, drafts: 1,
      finishedAt: new Date("2026-08-24T06:00:00Z"),
      axisStats: [],
      report: { someOtherField: true },
    });
    const body = await ((await GET(req)) as Response).json();
    expect(body.run.staleDropped).toBe(0);
    expect(body.run.undatedDropped).toBe(0);
  });

  it("offers each person as a filter chip", async () => {
    const body = await ((await GET(req)) as Response).json();
    expect(body.people).toEqual([{ contactId: "ct1", fullName: "Avigal Soreq" }]);
  });
});
