import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: { effectiveUserId: string }) => unknown) =>
    (req: unknown) =>
      h(req, { effectiveUserId: "owner1" }),
}));

const contactFindMany = vi.fn();
const contactUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      updateMany: (...a: unknown[]) => contactUpdateMany(...a),
    },
  },
}));

const { GET, PATCH } = await import("@/app/api/tech-radar/marks/route");

function req(url: string, body?: unknown): NextRequest {
  return {
    nextUrl: new URL(url),
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  contactFindMany.mockReset();
  contactUpdateMany.mockReset();
  contactFindMany.mockResolvedValue([]);
  contactUpdateMany.mockResolvedValue({ count: 1 });
});

describe("GET /api/tech-radar/marks", () => {
  it("lists only contacts carrying an explicit mark, scoped to the effective user", async () => {
    await GET(req("http://x/api/tech-radar/marks"));
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe("owner1");
    expect(where.removedAt).toBeNull();
    expect(where.NOT).toEqual({ radarInclude: null });
  });

  it("searches by name or company when q is given, and bounds the result set", async () => {
    await GET(req("http://x/api/tech-radar/marks?q=dana"));
    const args = contactFindMany.mock.calls[0][0];
    expect(args.where.ownerId).toBe("owner1");
    expect(args.where.OR).toEqual([
      { fullName: { contains: "dana", mode: "insensitive" } },
      { currentCompany: { contains: "dana", mode: "insensitive" } },
    ]);
    // An unbounded search would load the pilot owner's 16,250 contacts.
    expect(args.take).toBeGreaterThan(0);
  });

  it("treats a whitespace-only q as no search", async () => {
    await GET(req("http://x/api/tech-radar/marks?q=%20%20"));
    expect(contactFindMany.mock.calls[0][0].where.NOT).toEqual({ radarInclude: null });
  });
});

describe("PATCH /api/tech-radar/marks", () => {
  it("sets a mark", async () => {
    const res = await PATCH(req("http://x/api/tech-radar/marks", { contactId: "c1", radarInclude: true }));
    expect(res.status).toBe(200);
    expect(contactUpdateMany.mock.calls[0][0].data).toEqual({ radarInclude: true });
  });

  it("clears a mark with null", async () => {
    await PATCH(req("http://x/api/tech-radar/marks", { contactId: "c1", radarInclude: null }));
    expect(contactUpdateMany.mock.calls[0][0].data).toEqual({ radarInclude: null });
  });

  /**
   * The tenancy guard. The owner has to be in the WHERE, not checked separately, so a
   * contact belonging to someone else matches nothing instead of being updated.
   */
  it("scopes the update to the effective user", async () => {
    await PATCH(req("http://x/api/tech-radar/marks", { contactId: "c1", radarInclude: true }));
    expect(contactUpdateMany.mock.calls[0][0].where).toEqual({
      id: "c1",
      ownerId: "owner1",
      removedAt: null,
    });
  });

  it("404s when the contact is not this user's", async () => {
    contactUpdateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(req("http://x/api/tech-radar/marks", { contactId: "other", radarInclude: true }));
    expect(res.status).toBe(404);
  });

  /**
   * Coercion here would be actively dangerous: a truthy-ish junk value silently becoming
   * `false` means "never contact this person", the most damaging of the three states.
   * These must be rejected, not interpreted.
   */
  it.each([["string", "yes"], ["number", 1], ["undefined", undefined], ["object", {}]])(
    "rejects a %s radarInclude instead of coercing it",
    async (_label, value) => {
      const res = await PATCH(req("http://x/api/tech-radar/marks", { contactId: "c1", radarInclude: value }));
      expect(res.status).toBe(400);
      expect(contactUpdateMany).not.toHaveBeenCalled();
    },
  );

  it("requires a contactId", async () => {
    const res = await PATCH(req("http://x/api/tech-radar/marks", { radarInclude: true }));
    expect(res.status).toBe(400);
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });
});
