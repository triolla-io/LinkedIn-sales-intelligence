import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
/**
 * The stale-in-queue sweep (pacing moved to the release path, 2026-09-01): judgeAndDraft
 * closes queued drafts whose article crossed the freshness window while waiting. Mocked
 * to close nothing here so these tests keep testing what they were written for; the sweep
 * itself is covered by tests/unit/tech-radar-send-release.test.ts.
 */
const draftUpdateMany = vi.fn(async () => ({ count: 0 }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: { findMany: (...a: unknown[]) => axisFindMany(...a) },
    radarDraft: {
      findMany: (...a: unknown[]) => draftFindMany(...a),
      upsert: (...a: unknown[]) => draftUpsert(...a),
      updateMany: (...a: unknown[]) => draftUpdateMany(...a),
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
const { OpenRouterBlockedError } = await import("@/lib/openrouter/client");

function contact(id: string) {
  return { id, ownerId: "owner1", fullName: `Person ${id}`, hebrewFirstName: null, currentTitle: "CEO", currentCompany: "Acme" };
}

function axisWithMatches(
  matches: { itemId: string; publishedAt: Date | null; title: string; stature?: number }[],
  opts: { axisId?: string; kind?: string } = {}
) {
  return {
    id: opts.axisId ?? "a1",
    label: "ציר",
    // ROLE_COMPANY by default: the production-realistic case, and the one value that
    // makes deepestLayer -> 4 so passesLayerFloor never gates these tests unless a test
    // deliberately overrides kind to exercise the industry floor.
    kind: opts.kind ?? "ROLE_COMPANY",
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
        stature: m.stature ?? 0.9,
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

/**
 * Task 12: an item caught ONLY by the broad layer-1 INDUSTRY net needs a much higher
 * importance bar (INDUSTRY_ONLY_STATURE_FLOOR, layers.ts) before it reaches a real
 * person — the industry net is deliberately wide and cheap, and the point of the
 * narrower layers is to keep drafts specific. An item that ALSO reaches layer 3 or 4
 * (a COMPANY_MONITOR or ROLE_COMPANY axis matched it too) needs no floor at all.
 */
describe("judgeAndDraft industry floor", () => {
  it("drops an item whose only matched axis is INDUSTRY when stature is below the floor", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = axisWithMatches(
      [{ itemId: "ind1", publishedAt: freshAt, title: "n", stature: 0.7 }],
      { kind: "INDUSTRY" }
    );
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);

    const report = await judgeAndDraft("org1");

    expect(report.candidates).toBe(0);
    expect(report.drafted).toBe(0);
    expect(report.dropReasons.industry_floor).toBe(1);
    expect(selectRecipientsForItem).not.toHaveBeenCalled();
    expect(draftTechMessage).not.toHaveBeenCalled();
  });

  it("proceeds when the same INDUSTRY-only item clears the stature floor", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = axisWithMatches(
      [{ itemId: "ind2", publishedAt: freshAt, title: "n", stature: 0.85 }],
      { kind: "INDUSTRY" }
    );
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
    expect(report.dropReasons.industry_floor).toBeUndefined();
  });

  it("an item matched by both INDUSTRY and ROLE_COMPANY axes is layer 4 and needs no floor", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const industryAxis = axisWithMatches(
      [{ itemId: "mixed1", publishedAt: freshAt, title: "n", stature: 0.1 }],
      { axisId: "a1", kind: "INDUSTRY" }
    );
    const roleAxis = axisWithMatches(
      [{ itemId: "mixed1", publishedAt: freshAt, title: "n", stature: 0.1 }],
      { axisId: "a2", kind: "ROLE_COMPANY" }
    );
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [
      applyMatchesFilter(industryAxis, args.select),
      applyMatchesFilter(roleAxis, args.select),
    ]);
    selectRecipientsForItem.mockResolvedValue([
      {
        candidate: { contact: { contactId: "c1" }, axisId: "a1" },
        verdict: { outcome: "judged", whyHim: "why", adjustment: 0 },
        passed: true,
      },
    ]);

    const report = await judgeAndDraft("org1");

    expect(report.dropReasons.industry_floor).toBeUndefined();
    expect(report.drafted).toBe(1);
  });
});

describe("judgeAndDraft pilot gate", () => {
  function passingDecision() {
    return [
      {
        candidate: { contact: { contactId: "c1" }, axisId: "a1" },
        verdict: { outcome: "judged", whyHim: "why", adjustment: 0 },
        passed: true,
      },
    ];
  }

  function freshDraftableAxis() {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    return axisWithMatches([{ itemId: "fresh1", publishedAt: freshAt, title: "current news" }]);
  }

  let prevHold: string | undefined;
  beforeEach(() => {
    prevHold = process.env.RADAR_PILOT_HOLD;
  });
  afterEach(() => {
    if (prevHold === undefined) delete process.env.RADAR_PILOT_HOLD;
    else process.env.RADAR_PILOT_HOLD = prevHold;
  });

  it("a drafted row is born held (pilotHeldAt set) when the gate is on (default)", async () => {
    delete process.env.RADAR_PILOT_HOLD;
    const axis = freshDraftableAxis();
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue(passingDecision());

    await judgeAndDraft("org1");

    expect(draftUpsert).toHaveBeenCalledTimes(1);
    const payload = draftUpsert.mock.calls[0][0] as { create: { pilotHeldAt: Date | null } };
    expect(payload.create.pilotHeldAt).toBeInstanceOf(Date);
  });

  it("a drafted row is not held when RADAR_PILOT_HOLD=off", async () => {
    process.env.RADAR_PILOT_HOLD = "off";
    const axis = freshDraftableAxis();
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue(passingDecision());

    await judgeAndDraft("org1");

    expect(draftUpsert).toHaveBeenCalledTimes(1);
    const payload = draftUpsert.mock.calls[0][0] as { create: { pilotHeldAt: Date | null } };
    expect(payload.create.pilotHeldAt).toBeNull();
  });
});

describe("judgeAndDraft draft-call failures", () => {
  function passingDecision() {
    return [
      {
        candidate: { contact: { contactId: "c1" }, axisId: "a1" },
        verdict: { outcome: "judged", whyHim: "why", adjustment: 0 },
        passed: true,
      },
    ];
  }

  it("a genuine draft failure is counted and the run continues, not aborted", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = axisWithMatches([{ itemId: "fresh1", publishedAt: freshAt, title: "current news" }]);
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue(passingDecision());
    draftTechMessage.mockRejectedValue(new Error("tech-radar draft returned unparseable output"));

    const report = await judgeAndDraft("org1");

    expect(report.drafted).toBe(0);
    expect(report.dropReasons.draft_failed).toBe(1);
    expect(draftUpsert).not.toHaveBeenCalled();
  });

  it("a kill-switch/budget block (OpenRouterBlockedError) propagates instead of being counted", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = axisWithMatches([{ itemId: "fresh1", publishedAt: freshAt, title: "current news" }]);
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue(passingDecision());
    draftTechMessage.mockRejectedValue(new OpenRouterBlockedError("OpenRouter call blocked (tech-radar-draft): OPENROUTER_ENABLED=false (kill-switch)"));

    await expect(judgeAndDraft("org1")).rejects.toBeInstanceOf(OpenRouterBlockedError);
    expect(draftUpsert).not.toHaveBeenCalled();
  });

  /**
   * 2026-08-26, Gil Tamir: streamlinefeed.co.ke, a content farm. draftTechMessage
   * rejects a non-gift-worthy source outright (draft.ts, beside the search-engine-host
   * rejection) — this is a SOURCE problem, not a generic draft failure, so it gets its
   * own dropReasons bucket rather than being folded into draft_failed.
   */
  it("a non-gift-worthy source is counted as source_not_publisher, not draft_failed", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = axisWithMatches([{ itemId: "fresh1", publishedAt: freshAt, title: "current news" }]);
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue(passingDecision());
    draftTechMessage.mockRejectedValue(
      new Error("tech-radar draft rejected — source is not a gift-worthy publisher (aggregator): streamlinefeed.co.ke")
    );

    const report = await judgeAndDraft("org1");

    expect(report.drafted).toBe(0);
    expect(report.dropReasons.source_not_publisher).toBe(1);
    expect(report.dropReasons.draft_failed).toBeUndefined();
    expect(draftUpsert).not.toHaveBeenCalled();
  });
});

describe("judgeAndDraft unknown source hosts", () => {
  function passingDecision() {
    return [
      {
        candidate: { contact: { contactId: "c1" }, axisId: "a1" },
        verdict: { outcome: "judged", whyHim: "why", adjustment: 0 },
        passed: true,
      },
    ];
  }

  /**
   * `rejectsAsGift` PASSES an unknown host (the controller's ruling: never reject an
   * unrecognized host outright). judgeAndDraft collects which unknown hosts it actually
   * drafted from, so the allowlist in source-quality.ts can grow from evidence.
   */
  it("collects the unknown-host names it successfully drafted from, deduped", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = {
      id: "a1",
      label: "ציר",
      kind: "ROLE_COMPANY",
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
      matches: [
        {
          score: 0.9,
          item: {
            id: "item1",
            title: "t",
            summary: "s",
            technology: "tech",
            kind: "research",
            stature: 0.9,
            sources: [{ url: "https://a-fintech-startup-blog.example.com/post/1" }],
            publishedAt: freshAt,
          },
        },
      ],
    };
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue(passingDecision());
    draftTechMessage.mockResolvedValue("היי, ראית את זה?\nתוכן.\nhttps://a-fintech-startup-blog.example.com/post/1");

    const report = await judgeAndDraft("org1");

    expect(report.drafted).toBe(1);
    expect(report.unknownSourceHosts).toContain("a-fintech-startup-blog.example.com");
  });

  it("does not collect a recognized publisher's host", async () => {
    const freshAt = new Date(Date.now() - 3 * 86_400_000);
    const axis = {
      id: "a1",
      label: "ציר",
      kind: "ROLE_COMPANY",
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
      matches: [
        {
          score: 0.9,
          item: {
            id: "item1",
            title: "t",
            summary: "s",
            technology: "tech",
            kind: "research",
            stature: 0.9,
            sources: [{ url: "https://www.globes.co.il/news/article.aspx?did=1" }],
            publishedAt: freshAt,
          },
        },
      ],
    };
    axisFindMany.mockImplementation(async (args: { select: unknown }) => [applyMatchesFilter(axis, args.select)]);
    selectRecipientsForItem.mockResolvedValue(passingDecision());
    draftTechMessage.mockResolvedValue("היי, ראית את זה?\nתוכן.\nhttps://www.globes.co.il/news/article.aspx?did=1");

    const report = await judgeAndDraft("org1");

    expect(report.unknownSourceHosts).toEqual([]);
  });
});
