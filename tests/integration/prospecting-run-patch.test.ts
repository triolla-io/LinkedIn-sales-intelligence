import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

async function makeUserAndRun(window?: { sendDays: number[]; sendHoursStart: number; sendHoursEnd: number }) {
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.create({
    data: { email: `patch-${Date.now()}-${Math.random()}@x.com`, name: "T", orgId: org.id },
  });
  const run = await prisma.prospectingRun.create({
    data: { ownerId: user.id, name: "r", keywords: "cto", searchUrl: "x", ...(window ?? {}) },
  });
  return { user, run };
}

function makePatchReq(body: unknown) {
  return new NextRequest("http://localhost/api/prospecting/runs/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/prospecting/runs/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the send window for the owner", async () => {
    const { user, run } = await makeUserAndRun();
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    const { PATCH } = await import("@/app/api/prospecting/runs/[id]/route");
    const res = await PATCH(makePatchReq({ sendDays: [6, 5, 5], sendHoursStart: 10, sendHoursEnd: 14 }), {
      params: Promise.resolve({ id: run.id }),
    });
    expect(res.status).toBe(200);
    const reloaded = await prisma.prospectingRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(reloaded.sendDays).toEqual([5, 6]); // normalized: deduped + sorted
    expect(reloaded.sendHoursStart).toBe(10);
    expect(reloaded.sendHoursEnd).toBe(14);
  });

  it("rejects an invalid window with 400", async () => {
    const { user, run } = await makeUserAndRun();
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    const { PATCH } = await import("@/app/api/prospecting/runs/[id]/route");
    const res = await PATCH(makePatchReq({ sendHoursStart: 18, sendHoursEnd: 9 }), {
      params: Promise.resolve({ id: run.id }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for another user's run (tenancy)", async () => {
    const { run } = await makeUserAndRun();
    const { user: stranger } = await makeUserAndRun();
    mockAuth.mockResolvedValue({ user: { id: stranger.id } });
    const { PATCH } = await import("@/app/api/prospecting/runs/[id]/route");
    const res = await PATCH(makePatchReq({ sendDays: [0] }), { params: Promise.resolve({ id: run.id }) });
    expect(res.status).toBe(404);
    const reloaded = await prisma.prospectingRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(reloaded.sendDays).toEqual([]); // untouched
  });

  it("GET normalizes legacy empty sendDays to the default", async () => {
    const { user, run } = await makeUserAndRun(); // sendDays defaults to []
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    const { GET } = await import("@/app/api/prospecting/runs/[id]/route");
    const req = new NextRequest(`http://localhost/api/prospecting/runs/${run.id}`);
    const res = await GET(req, { params: Promise.resolve({ id: run.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.sendDays).toEqual([0, 1, 2, 3, 4]);
    expect(body.run.sendHoursStart).toBe(9);
    expect(body.run.sendHoursEnd).toBe(18);
  });
});
