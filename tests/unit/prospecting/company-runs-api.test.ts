import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const runCreate = vi.hoisted(() => vi.fn());
const runFindFirst = vi.hoisted(() => vi.fn());
const runUpdate = vi.hoisted(() => vi.fn());
const userFindUnique = vi.hoisted(() => vi.fn());
const targetCount = vi.hoisted(() => vi.fn());
const insertTargets = vi.hoisted(() => vi.fn());
const inngestSend = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/inngest/client", () => ({ inngest: { send: inngestSend } }));
vi.mock("@/lib/prospecting/company-targets", () => ({
  insertCompanyTargets: insertTargets,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: {
      create: runCreate,
      findFirst: runFindFirst,
      update: runUpdate,
    },
    prospectingCompanyTarget: { count: targetCount },
    user: { findUnique: userFindUnique, findUniqueOrThrow: userFindUnique },
  },
}));

function postReq(body: unknown) {
  return new NextRequest("http://test/api/prospecting/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const USER = {
  id: "user1",
  orgId: "org1",
  role: "SALESPERSON",
  routineConnectionsEnabled: true,
  org: { id: "org1", name: "Org" },
};

describe("POST /api/prospecting/runs (COMPANY)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    userFindUnique.mockResolvedValue(USER);
    runCreate.mockResolvedValue({ id: "run1", targetType: "COMPANY" });
    insertTargets.mockResolvedValue({
      added: 2,
      skippedExisting: 0,
      skippedInvalid: 0,
    });
  });

  it("creates a COMPANY run with worldwide geo, empty searchUrl and inline companies", async () => {
    const { POST } = await import("@/app/api/prospecting/runs/route");
    const res = await POST(
      postReq({
        targetType: "COMPANY",
        name: "clevel",
        keywords: 'CEO, CTO, CFO, COO, CMO, Founder, Owner, מנכ"ל, סמנכ"ל',
        dailyCap: 10,
        companies: [
          { name: "Acme" },
          { linkedinUrl: "https://www.linkedin.com/company/globex" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(runCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "COMPANY",
        geoUrn: "",
        searchUrl: "",
      }),
    });
    expect(insertTargets).toHaveBeenCalledWith(
      "run1",
      [
        expect.objectContaining({ name: "Acme" }),
        expect.objectContaining({ linkedinSlug: "globex" }),
      ],
      0,
    );
    const body = await res.json();
    expect(body.companies).toEqual({
      added: 2,
      skippedExisting: 0,
      skippedInvalid: 0,
    });
  });

  it("keeps the keyword-run behavior when targetType is absent", async () => {
    runCreate.mockResolvedValue({ id: "run2" });
    const { POST } = await import("@/app/api/prospecting/runs/route");
    const res = await POST(postReq({ name: "kw", keywords: "cto" }));
    expect(res.status).toBe(201);
    const data = runCreate.mock.calls[0][0].data;
    expect(data.targetType).toBe("KEYWORDS");
    expect(data.searchUrl).toContain("linkedin.com/search");
    expect(insertTargets).not.toHaveBeenCalled();
  });

  it("resolves a real geoCode for COMPANY runs when one is chosen", async () => {
    const { POST } = await import("@/app/api/prospecting/runs/route");
    await POST(
      postReq({
        targetType: "COMPANY",
        name: "x",
        keywords: "CEO",
        geoCode: "IL",
        companies: [{ name: "A" }],
      }),
    );
    expect(runCreate.mock.calls[0][0].data.geoUrn).toBe("101620260");
  });
});

describe("POST /api/prospecting/runs/[id]/start (COMPANY guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    userFindUnique.mockResolvedValue({
      ...USER,
      routineConnectionsEnabled: true,
    });
  });

  it("rejects a COMPANY run with zero non-REMOVED targets", async () => {
    runFindFirst.mockResolvedValue({
      id: "run1",
      status: "DRAFT",
      targetType: "COMPANY",
    });
    targetCount.mockResolvedValue(0);
    const { POST } =
      await import("@/app/api/prospecting/runs/[id]/start/route");
    const res = await POST(new NextRequest("http://test", { method: "POST" }), {
      params: Promise.resolve({ id: "run1" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_companies");
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("starts a COMPANY run that has targets", async () => {
    runFindFirst.mockResolvedValue({
      id: "run1",
      status: "DRAFT",
      targetType: "COMPANY",
    });
    targetCount.mockResolvedValue(3);
    runUpdate.mockResolvedValue({});
    const { POST } =
      await import("@/app/api/prospecting/runs/[id]/start/route");
    const res = await POST(new NextRequest("http://test", { method: "POST" }), {
      params: Promise.resolve({ id: "run1" }),
    });
    expect(res.status).toBe(200);
    expect(inngestSend).toHaveBeenCalledWith({
      name: "prospecting.start",
      data: { runId: "run1" },
    });
  });
});
