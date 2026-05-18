import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
    },
  },
}));

const ORG = { id: "org1", name: "Test Org", syncCadenceDays: 3, monthlyApolloBudget: 500, createdAt: new Date() };
const USER = { id: "user1", orgId: "org1", email: "a@test.com", name: "A", role: "SALESPERSON", org: ORG };
const ADMIN = { id: "admin1", orgId: "org1", email: "admin@test.com", name: "Admin", role: "ADMIN", org: ORG };

function makeReq(cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", `x-impersonation=${cookie}`);
  return new NextRequest("http://localhost/api/contacts", { headers });
}

describe("withTenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const { withTenant } = await import("@/lib/tenancy/with-tenant");
    const handler = withTenant(async (_req, _ctx) => ({ ok: true }));
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
  });

  it("sets effectiveUserId = user.id when no impersonation cookie", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockFindUnique.mockResolvedValue(USER);
    const { withTenant } = await import("@/lib/tenancy/with-tenant");

    let captured: any;
    const handler = withTenant(async (_req, ctx) => {
      captured = ctx;
      return { ok: true };
    });

    await handler(makeReq());
    expect(captured.effectiveUserId).toBe("user1");
    expect(captured.impersonatedUserId).toBeNull();
  });

  it("returns 403 when salesperson tries to impersonate", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockFindUnique.mockResolvedValue(USER); // role = SALESPERSON
    const { withTenant } = await import("@/lib/tenancy/with-tenant");
    const handler = withTenant(async () => ({ ok: true }));
    const res = await handler(makeReq("target-user-id"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when admin tries to impersonate cross-org user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1" } });
    // Admin is in org1, target is in org2
    mockFindUnique.mockResolvedValue({ ...ADMIN, orgId: "org1", org: ORG });
    // findFirst returns null (cross-org)
    const prismaMod = await import("@/lib/prisma");
    (prismaMod.prisma.user as any).findFirst = vi.fn().mockResolvedValue(null);
    const { withTenant } = await import("@/lib/tenancy/with-tenant");
    const handler = withTenant(async () => ({ ok: true }));
    const res = await handler(makeReq("cross-org-user"));
    expect(res.status).toBe(403);
  });
});
