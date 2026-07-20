import { describe, it, expect, vi, beforeEach } from "vitest";

const runFindFirst = vi.hoisted(() => vi.fn());
const runUpdate = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
const inngestSend = vi.hoisted(() => vi.fn());
const selectEnrichable = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: { findFirst: runFindFirst, update: runUpdate },
    extensionTask: { updateMany: vi.fn() },
    connectionRequest: { updateMany: vi.fn() },
    auditEvent: { create: auditCreate },
    user: { findUnique: vi.fn().mockResolvedValue({ routineConnectionsEnabled: true }) },
    prospectingCompanyTarget: { count: vi.fn().mockResolvedValue(1) },
  },
}));
vi.mock("@/inngest/client", () => ({ inngest: { send: inngestSend } }));
vi.mock("@/lib/contacts/enrich-budget", () => ({ selectEnrichableContacts: selectEnrichable }));

const ctx = { userId: "u1", orgId: "o1", email: "ariel@triolla.io" };
beforeEach(() => {
  vi.clearAllMocks();
  auditCreate.mockResolvedValue({});
});

describe("mcp actions", () => {
  it("enrichContacts rejects over-cap requests", async () => {
    const { enrichContacts, MAX_BULK } = await import("@/lib/mcp/actions");
    const ids = Array.from({ length: MAX_BULK + 1 }, (_, i) => `c${i}`);
    await expect(enrichContacts(ctx, { contactIds: ids })).rejects.toMatchObject({ code: "invalid" });
  });

  it("enrichContacts queues valid ids and audits", async () => {
    selectEnrichable.mockResolvedValue({ validIds: ["c1"], skipped: 0, creditsRemaining: 9 });
    // org budget lookup is inside selectEnrichableContacts (mocked), so no org fetch asserted here
    const { enrichContacts } = await import("@/lib/mcp/actions");
    const res = await enrichContacts(ctx, { contactIds: ["c1"] });
    expect(res).toEqual({ queued: 1, skipped: 0, creditsRemaining: 9 });
    expect(inngestSend).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: "u1", action: "mcp.enrich_contacts" }),
    });
  });

  it("prospectingPause 404s a foreign run", async () => {
    runFindFirst.mockResolvedValue(null);
    const { prospectingPause } = await import("@/lib/mcp/actions");
    await expect(prospectingPause(ctx, { runId: "r9" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("prospectingPause conflicts when run is not RUNNING", async () => {
    runFindFirst.mockResolvedValue({ id: "r1", status: "PAUSED" });
    const { prospectingPause } = await import("@/lib/mcp/actions");
    await expect(prospectingPause(ctx, { runId: "r1" })).rejects.toMatchObject({ code: "conflict" });
  });
});
