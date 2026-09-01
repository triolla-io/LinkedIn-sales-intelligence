import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import type { RankCandidate } from "@/lib/tech-radar/person-rank";

/**
 * Pacing is a SEND concern, not a discovery concern.
 *
 * Before this change the 7-day rule ran inside `rankForPeople`: a candidate whose person
 * had been messaged four days ago was dropped as `too_soon` and, because AxisMatch rows
 * are never re-judged for a pair that already produced a decision, thrown away forever.
 * A genuinely good article died because an unrelated message went out on Tuesday.
 *
 * Now everything that clears the floors becomes a draft, and the 7-day rule lives on the
 * release path: the draft waits in the person's queue and is withheld — with a reason on
 * screen — until their window opens. A draft that waited so long its article crossed
 * FRESHNESS_WINDOW_DAYS is CLOSED with a visible reason, never sent stale and never
 * silently dropped.
 *
 * No network, no LLM: prisma, the veto and the drafting are all mocked.
 */

const { ctx } = vi.hoisted(() => ({
  ctx: { effectiveUserId: "owner1", user: { name: "יובל", email: "yuval@triolla.io" }, org: { id: "org1" } },
}));

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      h(req, ctx),
}));

const axisFindMany = vi.fn();
const draftFindMany = vi.fn();
const draftFindFirst = vi.fn();
const draftUpsert = vi.fn();
const draftUpdate = vi.fn();
const draftUpdateMany = vi.fn();
const feedbackCreate = vi.fn();
const taskCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: { findMany: (...a: unknown[]) => axisFindMany(...a) },
    radarDraft: {
      findMany: (...a: unknown[]) => draftFindMany(...a),
      findFirst: (...a: unknown[]) => draftFindFirst(...a),
      upsert: (...a: unknown[]) => draftUpsert(...a),
      update: (...a: unknown[]) => draftUpdate(...a),
      updateMany: (...a: unknown[]) => draftUpdateMany(...a),
    },
    radarFeedback: { create: (...a: unknown[]) => feedbackCreate(...a) },
    extensionTask: { create: (...a: unknown[]) => taskCreate(...a) },
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

const { evaluateRelease, rankForPeople, MIN_DAYS_BETWEEN_MESSAGES, STALE_IN_QUEUE_REASON } = await import(
  "@/lib/tech-radar/person-rank"
);
const { judgeAndDraft } = await import("@/lib/tech-radar/judge-and-draft");
const { deriveJourney } = await import("@/lib/tech-radar/journey");
const { FRESHNESS_WINDOW_DAYS } = await import("@/lib/tech-radar/freshness");
const { PATCH } = await import("@/app/api/radar/drafts/[id]/route");

const DAY = 86_400_000;
const NOW = new Date("2026-09-01T09:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

// ───────────────────────── the rule itself ─────────────────────────

describe("evaluateRelease", () => {
  it("withholds a draft whose person was messaged inside the window, and says how long is left", () => {
    const v = evaluateRelease({ itemPublishedAt: ago(2), lastMessageAt: ago(4), now: NOW });
    expect(v.action).toBe("withhold");
    if (v.action !== "withhold") return;
    expect(v.reason).toBe("pacing");
    expect(v.daysUntilOpen).toBe(3);
    expect(v.hebrew).toContain("4");
    expect(v.hebrew.length).toBeGreaterThan(10);
  });

  it("withholds a person messaged today without inventing a day count", () => {
    const v = evaluateRelease({ itemPublishedAt: ago(1), lastMessageAt: NOW, now: NOW });
    expect(v.action).toBe("withhold");
    if (v.action !== "withhold") return;
    expect(v.daysUntilOpen).toBe(MIN_DAYS_BETWEEN_MESSAGES);
    expect(v.hebrew).toContain("היום");
  });

  it("releases once the window has passed", () => {
    const v = evaluateRelease({
      itemPublishedAt: ago(2),
      lastMessageAt: ago(MIN_DAYS_BETWEEN_MESSAGES),
      now: NOW,
    });
    expect(v.action).toBe("release");
  });

  it("releases someone who has never been messaged", () => {
    expect(evaluateRelease({ itemPublishedAt: ago(2), lastMessageAt: null, now: NOW }).action).toBe("release");
  });

  it("closes a draft whose article aged past the freshness window while it queued", () => {
    const v = evaluateRelease({
      itemPublishedAt: ago(FRESHNESS_WINDOW_DAYS + 3),
      lastMessageAt: null,
      now: NOW,
    });
    expect(v.action).toBe("close");
    if (v.action !== "close") return;
    expect(v.reason).toBe(STALE_IN_QUEUE_REASON);
    expect(v.ageDays).toBe(FRESHNESS_WINDOW_DAYS + 3);
    expect(v.hebrew).toContain("התיישנה בתור");
  });

  it("closes rather than withholds when the draft is both stale and paced", () => {
    const v = evaluateRelease({
      itemPublishedAt: ago(FRESHNESS_WINDOW_DAYS + 1),
      lastMessageAt: ago(1),
      now: NOW,
    });
    expect(v.action).toBe("close");
  });

  it("does NOT close an undated item — the ingest gate rejects those, this path must not delete pre-gate rows", () => {
    expect(evaluateRelease({ itemPublishedAt: null, lastMessageAt: null, now: NOW }).action).toBe("release");
  });

  it("honours explicit thresholds", () => {
    expect(
      evaluateRelease({ itemPublishedAt: ago(2), lastMessageAt: ago(4), now: NOW, minDaysBetweenMessages: 3 }).action
    ).toBe("release");
    expect(
      evaluateRelease({ itemPublishedAt: ago(10), lastMessageAt: null, now: NOW, freshnessWindowDays: 5 }).action
    ).toBe("close");
  });

  it("never returns a stop without a human-readable Hebrew reason", () => {
    const stops = [
      evaluateRelease({ itemPublishedAt: ago(1), lastMessageAt: ago(1), now: NOW }),
      evaluateRelease({ itemPublishedAt: ago(90), lastMessageAt: null, now: NOW }),
    ];
    for (const v of stops) {
      expect(v.action).not.toBe("release");
      if (v.action === "release") continue;
      expect(v.hebrew.trim()).not.toBe("");
      expect(v.hebrew).toMatch(/[֐-׿]/);
      expect(v.hebrew).not.toMatch(/[a-zA-Z_]{4,}/); // no internal vocabulary on screen
    }
  });
});

// ───────────────────────── discovery no longer paces ─────────────────────────

describe("rankForPeople", () => {
  function cand(over: Partial<RankCandidate> = {}): RankCandidate {
    return {
      contactId: "c1",
      itemId: "i1",
      axisId: "ax1",
      trackedCompanyId: "tc1",
      axisScore: 0.8,
      personWeight: 1,
      kind: "research",
      ...over,
    };
  }

  it("no longer drops anyone for pacing — that is the release path's job", () => {
    const out = rankForPeople({
      candidates: [cand()],
      alreadySeen: new Set<string>(),
      recentKinds: new Map<string, string[]>(),
      limit: 10,
    });
    expect(out.ranked).toHaveLength(1);
    expect(out.dropped.map((d) => d.reason)).not.toContain("too_soon");
  });
});

// ───────────────────────── the draft gets created ─────────────────────────

function axis(over: Record<string, unknown> = {}) {
  return {
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
          contact: {
            id: "c1",
            ownerId: "owner1",
            fullName: "פזית",
            hebrewFirstName: "פזית",
            currentTitle: "CIO",
            currentCompany: "Bank",
          },
        },
      },
    ],
    matches: [
      {
        score: 0.9,
        item: {
          id: "i1",
          title: "כתבה",
          summary: "s",
          technology: "tech",
          kind: "research",
          stature: 0.9,
          thin: false,
          sources: [{ url: "https://globes.co.il/a" }],
        },
      },
    ],
    ...over,
  };
}

describe("judgeAndDraft", () => {
  beforeEach(() => {
    for (const m of [axisFindMany, draftFindMany, draftUpsert, draftUpdateMany, selectRecipientsForItem, draftTechMessage])
      m.mockReset();
    axisFindMany.mockResolvedValue([axis()]);
    draftFindMany.mockResolvedValue([]);
    draftUpsert.mockResolvedValue({});
    draftUpdateMany.mockResolvedValue({ count: 0 });
    draftTechMessage.mockResolvedValue("היי, נתקלתי בזה https://globes.co.il/a");
    selectRecipientsForItem.mockImplementation(async ({ candidates }: { candidates: unknown[] }) =>
      (candidates as { contact: { contactId: string } }[]).map((candidate) => ({
        candidate,
        verdict: { outcome: "judged", whyHim: "כי זה בדיוק התחום שלה", adjustment: 0 },
        passed: true,
      }))
    );
  });

  it("still drafts for someone messaged inside the 7-day window (it used to delete the candidate)", async () => {
    draftFindMany.mockResolvedValue([
      {
        contactId: "c1",
        itemId: "iOld",
        createdAt: ago(4),
        status: "SENT",
        item: { kind: "trend" },
      },
    ]);
    const report = await judgeAndDraft("org1");
    expect(report.drafted).toBe(1);
    expect(report.dropReasons.too_soon).toBeUndefined();
    expect(draftUpsert).toHaveBeenCalled();
  });

  it("closes queued drafts whose article aged past the window, and reports the count", async () => {
    draftUpdateMany.mockResolvedValue({ count: 2 });
    const report = await judgeAndDraft("org1");
    expect(draftUpdateMany).toHaveBeenCalled();
    const call = draftUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown> & { item?: { publishedAt?: { lt?: Date } } };
      data: Record<string, unknown>;
    };
    expect(call.where.status).toBe("PENDING_REVIEW");
    expect(call.where.item?.publishedAt?.lt).toBeInstanceOf(Date);
    expect(call.data).toMatchObject({ status: "DISMISSED", discardReason: STALE_IN_QUEUE_REASON });
    expect(report.dropReasons[STALE_IN_QUEUE_REASON]).toBe(2);
  });
});

// ───────────────────────── the release gate on the route ─────────────────────────

const CANON = "https://globes.co.il/a";

function req(body: unknown) {
  return { nextUrl: { pathname: "/api/radar/drafts/d1" }, json: async () => body } as unknown as NextRequest;
}

function draftRow(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    contactId: "c1",
    draftMessage: `היי, נתקלתי בזה ${CANON}`,
    status: "PENDING_REVIEW",
    pilotHeldAt: null,
    contact: {
      id: "c1",
      fullName: "פזית",
      linkedinUrl: "https://linkedin.com/in/pazit",
      messages: [] as { sentAt: Date }[],
      radarDrafts: [] as { sentAt: Date | null }[],
    },
    item: { title: "כתבה", summary: "s", sources: [{ url: CANON, title: "t" }], publishedAt: ago(2) },
    ...over,
  };
}

describe("PATCH /api/radar/drafts/[id] — the release gate", () => {
  let prevPilotHold: string | undefined;

  beforeEach(() => {
    for (const m of [draftFindFirst, draftUpdate, draftUpdateMany, feedbackCreate, taskCreate]) m.mockReset();
    draftFindFirst.mockResolvedValue(draftRow());
    draftUpdate.mockResolvedValue({});
    draftUpdateMany.mockResolvedValue({ count: 1 });
    feedbackCreate.mockResolvedValue({});
    taskCreate.mockResolvedValue({});
    ctx.user.email = "yuval@triolla.io";
    prevPilotHold = process.env.RADAR_PILOT_HOLD;
    delete process.env.RADAR_PILOT_HOLD;
    // Only Date is faked: the route reads `new Date()` for the window maths, and faking
    // the timer queue too would stall the awaits in the handler.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (prevPilotHold === undefined) delete process.env.RADAR_PILOT_HOLD;
    else process.env.RADAR_PILOT_HOLD = prevPilotHold;
  });

  it("withholds a prepare inside the window, with the reason on screen and nothing queued", async () => {
    draftFindFirst.mockResolvedValue(
      draftRow({ contact: { ...draftRow().contact, messages: [{ sentAt: ago(3) }] } })
    );
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("withheld");
    expect(body.message).toMatch(/[֐-׿]/);
    expect(body.daysUntilOpen).toBe(4);
    expect(taskCreate).not.toHaveBeenCalled();
    expect(draftUpdateMany).not.toHaveBeenCalled();
  });

  it("counts a radar draft this person already received as a message", async () => {
    draftFindFirst.mockResolvedValue(
      draftRow({ contact: { ...draftRow().contact, radarDrafts: [{ sentAt: ago(1) }] } })
    );
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("withheld");
  });

  it("releases the prepare once the window is open", async () => {
    draftFindFirst.mockResolvedValue(
      draftRow({ contact: { ...draftRow().contact, messages: [{ sentAt: ago(9) }] } })
    );
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(200);
    expect(taskCreate).toHaveBeenCalled();
  });

  it("closes a prepare whose article aged past the window, with a visible reason and no task", async () => {
    draftFindFirst.mockResolvedValue(draftRow({ item: { ...draftRow().item, publishedAt: ago(FRESHNESS_WINDOW_DAYS + 5) } }));
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(STALE_IN_QUEUE_REASON);
    expect(body.message).toContain("התיישנה בתור");
    expect(draftUpdate.mock.calls[0][0].data).toMatchObject({
      status: "DISMISSED",
      discardReason: STALE_IN_QUEUE_REASON,
    });
    expect(feedbackCreate).toHaveBeenCalled();
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("still prepares an undated item rather than closing it silently", async () => {
    draftFindFirst.mockResolvedValue(draftRow({ item: { ...draftRow().item, publishedAt: null } }));
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(200);
    expect(taskCreate).toHaveBeenCalled();
  });

  it("leaves save, dismiss and sent alone — the gate is on release, not on bookkeeping", async () => {
    draftFindFirst.mockResolvedValue(
      draftRow({ contact: { ...draftRow().contact, messages: [{ sentAt: ago(1) }] } })
    );
    for (const body of [
      { action: "save", message: `נתקלתי בזה ${CANON}` },
      { action: "dismiss", reason: "not_now" },
      { action: "sent" },
    ]) {
      const res = (await PATCH(req(body))) as Response;
      expect(res.status).toBe(200);
    }
  });

  /** The pilot gate is the outer wall and must not have moved: held → 404 for its owner. */
  it("keeps the pilot hold: a held draft 404s for its non-reviewer owner even with the window open", async () => {
    draftFindFirst.mockImplementation(async (args: { where?: { pilotHeldAt?: null } }) => {
      const row = draftRow({ pilotHeldAt: new Date("2026-08-28T06:00:00Z") });
      if (args?.where && "pilotHeldAt" in args.where) return null;
      return row;
    });
    ctx.user.email = "yuval@triolla.io";
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(404);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("keeps the pilot hold: a reviewer can still prepare a held draft whose window is open", async () => {
    draftFindFirst.mockResolvedValue(draftRow({ pilotHeldAt: new Date("2026-08-28T06:00:00Z") }));
    ctx.user.email = "ariel@triolla.io";
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(200);
    expect(taskCreate).toHaveBeenCalled();
  });
});

// ───────────────────────── the closed draft explains itself ─────────────────────────

describe("deriveJourney — a draft closed by aging out", () => {
  it("says it aged out in the queue instead of blaming the reader", () => {
    const j = deriveJourney({
      item: { thin: false, shareworthy: 0.9, stature: 0.8, kind: "big_news" },
      match: { score: 0.8, rationale: "התחום שלה" },
      draft: { status: "DISMISSED", whyHim: "כי זה התחום שלה", discardReason: STALE_IN_QUEUE_REASON },
    });
    const draftStep = j.steps.find((s) => s.key === "draft")!;
    expect(draftStep.value).toContain("התיישנה בתור");
    expect(draftStep.value).not.toContain("דילגת");
    expect(j.verdict.text).toContain("התיישנה בתור");
  });
});
