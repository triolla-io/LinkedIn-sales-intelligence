import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * An override lifts the REJECTION, not the quality bar. The message is written by the
 * same guarded path the pipeline uses; if that path cannot produce a clean message the
 * override fails loudly rather than storing one the pipeline would have refused.
 */

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      h(req, { effectiveUserId: "owner1", user: { name: "אריאל" }, org: { id: "org1" } }),
}));

const draftFindFirst = vi.fn();
const draftUpdateMany = vi.fn();
const feedbackCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarDraft: {
      findFirst: (...a: unknown[]) => draftFindFirst(...a),
      updateMany: (...a: unknown[]) => draftUpdateMany(...a),
    },
    radarFeedback: { create: (...a: unknown[]) => feedbackCreate(...a) },
  },
}));

const draftTechMessage = vi.fn();
vi.mock("@/lib/tech-radar/draft", () => ({
  draftTechMessage: (...a: unknown[]) => draftTechMessage(...a),
}));

const { POST } = await import("@/app/api/radar/drafts/[id]/override/route");

function req(body?: unknown) {
  return {
    nextUrl: { pathname: "/api/radar/drafts/d1/override" },
    json: async () => body ?? {},
  } as unknown as NextRequest;
}

function vetoed(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    status: "VETOED",
    whyHim: null,
    discardReason: "not_person_specific",
    contact: {
      fullName: "Ofir Alon",
      hebrewFirstName: "אופיר",
      currentTitle: "CFO",
      currentCompany: "Delek US Holdings",
    },
    item: {
      title: "Refining margins hold",
      summary: "Margins stay strong",
      technology: null,
      sources: [{ url: "https://kpler.com/x", title: "t" }],
    },
    ...over,
  };
}

beforeEach(() => {
  for (const m of [draftFindFirst, draftUpdateMany, feedbackCreate, draftTechMessage]) m.mockReset();
  draftFindFirst.mockResolvedValue(vetoed());
  draftUpdateMany.mockResolvedValue({ count: 1 });
  feedbackCreate.mockResolvedValue({});
  draftTechMessage.mockResolvedValue("היי אופיר, נתקלתי בזה https://kpler.com/x");
});

describe("POST /api/radar/drafts/[id]/override", () => {
  it("re-drafts through the normal guarded path and re-opens the draft", async () => {
    const res = (await POST(req({ reason: "הוא בדיוק עוסק בזה עכשיו" }))) as Response;
    expect(res.status).toBe(200);
    expect(draftTechMessage).toHaveBeenCalled();
    expect(draftUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "d1", status: "VETOED" },
      data: { status: "PENDING_REVIEW" },
    });
  });

  it("passes the human's reason as the person-specific argument", async () => {
    await POST(req({ reason: "הוא בדיוק עוסק בזה עכשיו" }));
    expect(draftTechMessage.mock.calls[0][0].fitRationale).toBe("הוא בדיוק עוסק בזה עכשיו");
  });

  it("records why the gate was wrong, not only that it was", async () => {
    await POST(req({ reason: "הוא בדיוק עוסק בזה עכשיו" }));
    expect(feedbackCreate.mock.calls[0][0].data).toMatchObject({
      draftId: "d1",
      event: "OVERRIDDEN",
      reason: "הוא בדיוק עוסק בזה עכשיו",
    });
  });

  it("only a rejection can be lifted", async () => {
    draftFindFirst.mockResolvedValue(vetoed({ status: "PENDING_REVIEW" }));
    const res = (await POST(req())) as Response;
    expect(res.status).toBe(409);
    expect(draftTechMessage).not.toHaveBeenCalled();
  });

  it("a second click cannot override the same rejection twice", async () => {
    draftUpdateMany.mockResolvedValue({ count: 0 });
    const res = (await POST(req())) as Response;
    expect(res.status).toBe(409);
    expect(feedbackCreate).not.toHaveBeenCalled();
  });

  it("a message the guard refuses fails the override instead of being stored", async () => {
    draftTechMessage.mockRejectedValue(new Error("draft-guard: ask"));
    const res = (await POST(req())) as Response;
    expect(res.status).toBe(502);
    expect(draftUpdateMany).not.toHaveBeenCalled();
    expect(feedbackCreate).not.toHaveBeenCalled();
  });

  it("another owner's draft 404s and writes nothing", async () => {
    draftFindFirst.mockResolvedValue(null);
    const res = (await POST(req())) as Response;
    expect(res.status).toBe(404);
    expect(draftTechMessage).not.toHaveBeenCalled();
  });

  it("works without a reason, falling back to what the gate said", async () => {
    draftFindFirst.mockResolvedValue(vetoed({ whyHim: "הוא מחזיק בהחלטה" }));
    const res = (await POST(req({}))) as Response;
    expect(res.status).toBe(200);
    expect(draftTechMessage.mock.calls[0][0].fitRationale).toBe("הוא מחזיק בהחלטה");
    expect(feedbackCreate.mock.calls[0][0].data.reason).toBeNull();
  });
});
