import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: (h: (req: unknown, ctx: { effectiveUserId: string }) => unknown) => (req: unknown) => h(req, { effectiveUserId: "owner1" }),
}));
const articleFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { fintechArticle: { findMany: (...a: unknown[]) => articleFindMany(...a) }, articleMatch: {} } }));

import { GET } from "@/app/api/fintech-radar/route";

beforeEach(() => articleFindMany.mockReset());

describe("GET /api/fintech-radar", () => {
  it("returns the caller's suggested matches grouped by article", async () => {
    articleFindMany.mockResolvedValue([
      { id: "a1", title: "T", summary: "S", url: "https://x/a", source: "fintech-radar", publishedAt: null,
        matches: [{ id: "m1", score: 0.8, reason: "r", draftMessage: "hi", contact: { fullName: "Y", currentTitle: "CFO", email: "y@x.com", phone: null, linkedinUrl: "https://li/y" } }] },
    ]);
    const res = await GET(new Request("http://x/api/fintech-radar") as never);
    const json = await (res as Response).json();
    expect(json.articles).toHaveLength(1);
    expect(json.articles[0].matches[0].contact.email).toBe("y@x.com");
    // must scope matches to ownerId
    expect(articleFindMany.mock.calls[0][0].where.matches.some.ownerId).toBe("owner1");
  });
});
