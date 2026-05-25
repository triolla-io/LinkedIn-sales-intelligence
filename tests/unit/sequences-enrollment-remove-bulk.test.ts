import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockEnrollmentFindMany = vi.hoisted(() => vi.fn());
const mockExecutionUpdateMany = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sequenceEnrollment: {
      findMany: mockEnrollmentFindMany,
    },
    sequenceStepExecution: {
      updateMany: mockExecutionUpdateMany,
    },
    user: { findUnique: mockUserFindUnique },
  },
}));

import { POST } from "@/app/api/sequences/[id]/enrollments/remove-bulk/route";

const ORG = { id: "org1", name: "TestOrg" };
const USER = { id: "user1", orgId: "org1", email: "a@x.com", name: "U", role: "SALESPERSON", org: ORG };

function makeReq(body: unknown) {
  return new NextRequest(
    "http://localhost/api/sequences/seq1/enrollments/remove-bulk",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user1" } });
  mockUserFindUnique.mockResolvedValue(USER);
});

describe("POST /api/sequences/[id]/enrollments/remove-bulk", () => {
  it("sets PENDING executions to SKIPPED for all given enrollmentIds and returns skipped count", async () => {
    mockEnrollmentFindMany.mockResolvedValue([{ id: "enr1" }, { id: "enr2" }]);
    mockExecutionUpdateMany.mockResolvedValue({ count: 3 });

    const res = await POST(makeReq({ enrollmentIds: ["enr1", "enr2"] }), {
      params: Promise.resolve({ id: "seq1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.skipped).toBe(3);
    expect(mockExecutionUpdateMany).toHaveBeenCalledWith({
      where: { enrollmentId: { in: ["enr1", "enr2"] }, status: "PENDING" },
      data: { status: "SKIPPED" },
    });
  });

  it("returns 400 when enrollmentIds is missing", async () => {
    const res = await POST(makeReq({}), {
      params: Promise.resolve({ id: "seq1" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when enrollmentIds is an empty array", async () => {
    const res = await POST(makeReq({ enrollmentIds: [] }), {
      params: Promise.resolve({ id: "seq1" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 403 when some enrollmentIds are not owned", async () => {
    // Only 1 of 2 requested IDs is owned
    mockEnrollmentFindMany.mockResolvedValue([{ id: "enr1" }] as never);

    const res = await POST(
      makeReq({ enrollmentIds: ["enr1", "enr2-not-owned"] }),
      { params: Promise.resolve({ id: "seq1" }) }
    );
    expect(res.status).toBe(403);
  });
});
