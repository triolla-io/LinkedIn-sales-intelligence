import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Candidate search must run in the DATABASE. The first version shipped 500 contacts to
 * the browser and filtered there — with 22,919 contacts on the pilot owner that is 2% of
 * the list, alphabetically, so anyone late in the alphabet could not be found no matter
 * what you typed. And nothing on screen said the list had been cut.
 */

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      h(req, { effectiveUserId: "owner1", user: { name: "אריאל" }, org: { id: "org1" } }),
}));

const contactFindMany = vi.fn();
const contactCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
  },
}));

const { GET, CANDIDATE_PAGE } = await import("@/app/api/radar/people/candidates/route");

function req(q?: string) {
  const url = new URL(`http://x/api/radar/people/candidates${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  contactFindMany.mockReset();
  contactCount.mockReset();
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
});

describe("GET /api/radar/people/candidates", () => {
  it("searches in the database across name, title and company", async () => {
    await GET(req("סורק"));
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe("owner1");
    expect(where.removedAt).toBeNull();
    const fields = (where.AND ?? []).flatMap((c: { OR?: { [k: string]: unknown }[] }) => c.OR ?? []);
    const keys = fields.map((f: Record<string, unknown>) => Object.keys(f)[0]);
    expect(keys).toEqual(expect.arrayContaining(["fullName", "currentTitle", "currentCompany"]));
  });

  it("never offers someone already on the radar", async () => {
    await GET(req("a"));
    const where = contactFindMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("radarInclude");
  });

  it("reports truncation instead of silently cutting the list", async () => {
    contactFindMany.mockResolvedValue(
      Array.from({ length: CANDIDATE_PAGE }, (_, i) => ({
        id: `c${i}`, fullName: `Person ${i}`, currentTitle: null, currentCompany: null,
      }))
    );
    contactCount.mockResolvedValue(312);
    const body = await ((await GET(req("a"))) as Response).json();
    expect(body.truncated).toBe(true);
    expect(body.total).toBe(312);
    expect(body.candidates).toHaveLength(CANDIDATE_PAGE);
  });

  it("does not claim truncation when everything fits", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1", fullName: "A", currentTitle: null, currentCompany: null }]);
    contactCount.mockResolvedValue(1);
    const body = await ((await GET(req("a"))) as Response).json();
    expect(body.truncated).toBe(false);
  });

  it("an empty query asks the user to type rather than dumping the address book", async () => {
    const body = await ((await GET(req(""))) as Response).json();
    expect(body.candidates).toEqual([]);
    expect(body.needsQuery).toBe(true);
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it("a one-character query still searches — Hebrew names are short", async () => {
    await GET(req("ד"));
    expect(contactFindMany).toHaveBeenCalled();
  });
});
