import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockFindMany = vi.hoisted(() => vi.fn());
const mockCreateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "user1", orgId: null, role: "SALESPERSON", org: null }) },
    sequence: { findFirst: mockFindFirst },
    sequenceEnrollment: { createMany: mockCreateMany, findMany: mockFindMany },
    sequenceStepExecution: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/sequences/seq1/enrollments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user1" } });
});

describe("POST /api/sequences/[id]/enrollments", () => {
  it("returns 404 when sequence not found", async () => {
    mockFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/sequences/[id]/enrollments/route");
    const res = await POST(makeReq({ contactIds: ["c1"] }), {
      params: Promise.resolve({ id: "seq1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when sequence has no steps", async () => {
    mockFindFirst.mockResolvedValue({ id: "seq1", ownerId: "user1", steps: [] });
    const { POST } = await import("@/app/api/sequences/[id]/enrollments/route");
    const res = await POST(makeReq({ contactIds: ["c1"] }), {
      params: Promise.resolve({ id: "seq1" }),
    });
    expect(res.status).toBe(400);
  });

  it("enrolls contacts and returns counts", async () => {
    const firstStep = { id: "step1", dayOffset: 0, sendHour: 9, sendMinute: 0 };
    mockFindFirst.mockResolvedValue({ id: "seq1", ownerId: "user1", steps: [firstStep] });
    mockCreateMany.mockResolvedValue({ count: 1 });
    mockFindMany.mockResolvedValue([
      { id: "enr1", enrolledAt: new Date("2026-06-02T09:00:00Z"), executions: [] },
    ]);
    const { POST } = await import("@/app/api/sequences/[id]/enrollments/route");
    const res = await POST(makeReq({ contactIds: ["c1"] }), {
      params: Promise.resolve({ id: "seq1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enrolled).toBe(1);
    expect(json.skipped).toBe(0);
  });
});
