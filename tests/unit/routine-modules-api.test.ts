import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockOrgUpdate = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, findUniqueOrThrow: mockUserFindUnique, update: mockUserUpdate },
    organization: { update: mockOrgUpdate },
  },
}));

const ORG = { id: "org1", name: "Org", jobCheckEnabled: false };
const USER = {
  id: "user1",
  orgId: "org1",
  email: "a@t.com",
  name: "A",
  role: "SALESPERSON",
  routineConnectionsEnabled: true,
  org: ORG,
};

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/routine/modules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/routine/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
  });

  it("GET returns all module flags for the effective user", async () => {
    const { GET } = await import("@/app/api/routine/modules/route");
    const res = await GET(new NextRequest("http://localhost/api/routine/modules"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connectionsEnabled: true,
      jobChecksEnabled: false,
      companySignalsEnabled: false,
    });
  });

  it("PATCH connections=false updates the user flag", async () => {
    mockUserUpdate.mockResolvedValue({});
    const { PATCH } = await import("@/app/api/routine/modules/route");
    const res = await PATCH(patchReq({ module: "connections", enabled: false }));
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: { routineConnectionsEnabled: false },
    });
  });

  it("PATCH jobChecks=true updates the org flag", async () => {
    mockOrgUpdate.mockResolvedValue({});
    const { PATCH } = await import("@/app/api/routine/modules/route");
    const res = await PATCH(patchReq({ module: "jobChecks", enabled: true }));
    expect(res.status).toBe(200);
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { jobCheckEnabled: true },
    });
  });

  it("PATCH rejects an unknown module or non-boolean enabled", async () => {
    const { PATCH } = await import("@/app/api/routine/modules/route");
    expect((await PATCH(patchReq({ module: "nope", enabled: true }))).status).toBe(400);
    expect((await PATCH(patchReq({ module: "connections", enabled: "yes" }))).status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });
});
