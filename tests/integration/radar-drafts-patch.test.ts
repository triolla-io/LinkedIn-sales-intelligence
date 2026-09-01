import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The draft actions. The load-bearing rules:
 * - save: HARD guard violations reject with 422 and change nothing; soft ones save and
 *   come back as warnings; every save logs EDITED with the previous text (the fuel of
 *   phrasing-learning).
 * - prepare: claims PENDING_REVIEW only (double-click cannot queue two extension tasks)
 *   and the task carries radarDraftId so the extension result can advance the status.
 * - dismiss: the reason lands on the draft AND in the feedback log.
 * - pilot gate: a held draft 404s for a non-reviewer trying to act on it — this is the
 *   ACTUAL enforcement, not just visibility (2026-08-26 final review, Finding 3d).
 */

// A mutable ctx so pilot-gate tests can swap the requesting user's email between the
// owner (held from) and a reviewer (can act on a held draft too), same pattern as
// radar-approvals-route.test.ts.
const { ctx } = vi.hoisted(() => ({
  ctx: { effectiveUserId: "owner1", user: { name: "יובל", email: "yuval@triolla.io" }, org: { id: "org1" } },
}));

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      h(req, ctx),
}));

const draftFindFirst = vi.fn();
const draftUpdate = vi.fn();
const draftUpdateMany = vi.fn();
const feedbackCreate = vi.fn();
const taskCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarDraft: {
      findFirst: (...a: unknown[]) => draftFindFirst(...a),
      update: (...a: unknown[]) => draftUpdate(...a),
      updateMany: (...a: unknown[]) => draftUpdateMany(...a),
    },
    radarFeedback: { create: (...a: unknown[]) => feedbackCreate(...a) },
    extensionTask: { create: (...a: unknown[]) => taskCreate(...a) },
  },
}));

const { PATCH } = await import("@/app/api/radar/drafts/[id]/route");

const CANON = "https://ethanolproducer.com/articles/epa-rvo-2026";

function req(body: unknown) {
  return { nextUrl: { pathname: "/api/radar/drafts/d1" }, json: async () => body } as unknown as NextRequest;
}

function draftRow(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    draftMessage: `היי אביגל, היעד עלה ל-24.02 מיליארד גלון ${CANON}`,
    status: "PENDING_REVIEW",
    // messages/radarDrafts: the release gate's pacing signal, read in the same query
    // (2026-09-01 — pacing moved from draft creation to release). Empty here = never
    // messaged, so these tests exercise the release path exactly as before.
    contact: {
      fullName: "Avigal Soreq",
      linkedinUrl: "https://linkedin.com/in/avigal",
      messages: [] as { sentAt: Date }[],
      radarDrafts: [] as { sentAt: Date | null }[],
    },
    item: {
      title: "EPA finalizes RVOs",
      summary: "EPA set targets of 24.02 billion gallons",
      sources: [{ url: CANON, title: "t" }],
      publishedAt: new Date(Date.now() - 2 * 86_400_000),
    },
    ...over,
  };
}

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
});

afterEach(() => {
  if (prevPilotHold === undefined) delete process.env.RADAR_PILOT_HOLD;
  else process.env.RADAR_PILOT_HOLD = prevPilotHold;
});

describe("PATCH /api/radar/drafts/[id]", () => {
  it("rejects a save with a foreign link (422) and touches nothing", async () => {
    const res = (await PATCH(req({ action: "save", message: `תראה https://bit.ly/xyz ${CANON}` }))) as Response;
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.hard).toContain("foreign_link");
    expect(draftUpdate).not.toHaveBeenCalled();
    expect(feedbackCreate).not.toHaveBeenCalled();
  });

  it("saves an edit, returns soft warnings, and logs EDITED with the previous text", async () => {
    const res = (await PATCH(req({ action: "save", message: `אולי תוכלו לשלב, מעניין ${CANON}` }))) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.soft).toContain("adoption_suggestion");
    expect(draftUpdate.mock.calls[0][0].data.draftMessage).toContain("אולי תוכלו לשלב");
    expect(feedbackCreate.mock.calls[0][0].data).toMatchObject({
      draftId: "d1",
      event: "EDITED",
      draftBefore: expect.stringContaining("24.02"),
    });
  });

  it("prepare claims PENDING_REVIEW only and creates a task carrying radarDraftId", async () => {
    const res = (await PATCH(req({ action: "prepare", message: `נתקלתי בזה ${CANON}` }))) as Response;
    expect(res.status).toBe(200);
    expect(draftUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "d1", status: "PENDING_REVIEW" },
      data: { status: "PREPARING" },
    });
    expect(taskCreate.mock.calls[0][0].data).toMatchObject({
      kind: "PREPARE_MESSAGE",
      radarDraftId: "d1",
      userId: "owner1",
    });
  });

  it("prepare on an already-claimed draft returns 409 and queues nothing", async () => {
    draftUpdateMany.mockResolvedValue({ count: 0 });
    const res = (await PATCH(req({ action: "prepare", message: `x ${CANON}` }))) as Response;
    expect(res.status).toBe(409);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("dismiss stores the reason on the draft and in the feedback log", async () => {
    const res = (await PATCH(req({ action: "dismiss", reason: "weak_source" }))) as Response;
    expect(res.status).toBe(200);
    expect(draftUpdate.mock.calls[0][0].data).toMatchObject({ status: "DISMISSED", discardReason: "weak_source" });
    expect(feedbackCreate.mock.calls[0][0].data).toMatchObject({ event: "DISCARDED", reason: "weak_source" });
  });

  it("sent marks the draft and logs SENT with the final text", async () => {
    const res = (await PATCH(req({ action: "sent" }))) as Response;
    expect(res.status).toBe(200);
    expect(draftUpdate.mock.calls[0][0].data).toMatchObject({ status: "SENT", sentAt: expect.any(Date) });
    expect(feedbackCreate.mock.calls[0][0].data).toMatchObject({ event: "SENT", sentAfter: expect.stringContaining("24.02") });
  });

  it("a draft of another owner 404s", async () => {
    draftFindFirst.mockResolvedValue(null);
    const res = (await PATCH(req({ action: "dismiss", reason: "not_now" }))) as Response;
    expect(res.status).toBe(404);
  });
});

/**
 * The pilot gate, finding 3d — the most important of the four: without this, a held
 * draft's id (reachable directly, or leaked by any of the other three routes before
 * their own fix) could still be prepared or marked sent by its owner, bypassing the
 * whole review gate. The mocked findFirst applies the same pilotHeldAt: null predicate
 * Postgres would, so this catches a route that forgets the where clause entirely.
 */
describe("PATCH /api/radar/drafts/[id] — pilot gate", () => {
  function heldRow(over: Record<string, unknown> = {}) {
    return { ...draftRow(), pilotHeldAt: new Date("2026-08-26T06:00:00Z"), ...over };
  }
  function mockRowRespectingPilotFilter(row: ReturnType<typeof heldRow> | null) {
    draftFindFirst.mockImplementation(async (args: { where?: { pilotHeldAt?: null } }) => {
      if (!row) return null;
      if (args?.where && "pilotHeldAt" in args.where && row.pilotHeldAt !== null) return null;
      return row;
    });
  }

  it("a held draft 404s for its non-reviewer owner trying to dismiss it", async () => {
    mockRowRespectingPilotFilter(heldRow());
    ctx.user.email = "yuval@triolla.io";
    const res = (await PATCH(req({ action: "dismiss", reason: "not_now" }))) as Response;
    expect(res.status).toBe(404);
    expect(draftUpdate).not.toHaveBeenCalled();
  });

  it("a held draft 404s for its non-reviewer owner trying to mark it sent", async () => {
    mockRowRespectingPilotFilter(heldRow());
    ctx.user.email = "yuval@triolla.io";
    const res = (await PATCH(req({ action: "sent" }))) as Response;
    expect(res.status).toBe(404);
    expect(draftUpdate).not.toHaveBeenCalled();
  });

  it("a reviewer can still act on a held draft", async () => {
    mockRowRespectingPilotFilter(heldRow());
    ctx.user.email = "ariel@triolla.io";
    const res = (await PATCH(req({ action: "dismiss", reason: "not_now" }))) as Response;
    expect(res.status).toBe(200);
    expect(draftUpdate).toHaveBeenCalled();
  });

  it("with RADAR_PILOT_HOLD=off the owner can act on it too", async () => {
    process.env.RADAR_PILOT_HOLD = "off";
    mockRowRespectingPilotFilter(heldRow());
    ctx.user.email = "yuval@triolla.io";
    const res = (await PATCH(req({ action: "dismiss", reason: "not_now" }))) as Response;
    expect(res.status).toBe(200);
  });

  it("an unheld draft is unaffected in every case", async () => {
    for (const email of ["yuval@triolla.io", "ariel@triolla.io"]) {
      mockRowRespectingPilotFilter({ ...draftRow(), pilotHeldAt: null });
      ctx.user.email = email;
      const res = (await PATCH(req({ action: "dismiss", reason: "not_now" }))) as Response;
      expect(res.status).toBe(200);
    }
  });
});
