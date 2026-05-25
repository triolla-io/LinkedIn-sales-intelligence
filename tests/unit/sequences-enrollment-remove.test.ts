import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockEnrollmentFindFirst = vi.hoisted(() => vi.fn());
const mockExecutionUpdateMany = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sequenceEnrollment: {
      findFirst: mockEnrollmentFindFirst,
    },
    sequenceStepExecution: {
      updateMany: mockExecutionUpdateMany,
    },
    user: { findUnique: mockUserFindUnique },
  },
}));

import { POST } from "@/app/api/sequences/[id]/enrollments/[enrollmentId]/remove/route";

const ORG = { id: "org1", name: "TestOrg" };
const USER = { id: "user1", orgId: "org1", email: "a@x.com", name: "U", role: "SALESPERSON", org: ORG };

const mockEnrollment = {
  id: "enr1",
  sequenceId: "seq1",
  contactId: "c1",
  status: "ACTIVE",
};

function makeReq() {
  return new NextRequest(
    "http://localhost/api/sequences/seq1/enrollments/enr1/remove",
    { method: "POST" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user1" } });
  mockUserFindUnique.mockResolvedValue(USER);
});

describe("POST /api/sequences/[id]/enrollments/[enrollmentId]/remove", () => {
  it("sets PENDING executions to SKIPPED", async () => {
    mockEnrollmentFindFirst.mockResolvedValue(mockEnrollment);
    mockExecutionUpdateMany.mockResolvedValue({ count: 2 });

    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: "seq1", enrollmentId: "enr1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.skipped).toBe(2);
    expect(mockExecutionUpdateMany).toHaveBeenCalledWith({
      where: { enrollmentId: "enr1", status: "PENDING" },
      data: { status: "SKIPPED" },
    });
  });

  it("returns 404 when enrollment not found", async () => {
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: "seq1", enrollmentId: "enr1" }),
    });

    expect(res.status).toBe(404);
  });
});
