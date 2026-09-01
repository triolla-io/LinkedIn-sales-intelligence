import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The source-pack editing screen's API. Spec part 2: "עריכה במסך: מחיקה/הוספה/החלפה של
 * מקור = פעולת UI, לא דיפלוי" — the whole point of the table is that changing WHAT the
 * radar reads stops being a deploy.
 *
 * Two behaviours here are load-bearing and easy to get wrong:
 *
 * 1. **The 10+10 count is a TARGET, not validation.** A brand-new industry legitimately
 *    starts incomplete, and rejecting the write would leave that industry with no
 *    sources at all — strictly worse than a short pack. So a short pack saves, and is
 *    FLAGGED so nobody mistakes it for finished.
 * 2. **A global pack (orgId = null) is copy-on-write.** Editing it in place would rewrite
 *    every other org's sources from inside one org's screen. The schema's own words:
 *    "Null = a built-in pack every org falls back to; set = that org's edited copy."
 */

const { ctx } = vi.hoisted(() => ({
  ctx: {
    effectiveUserId: "owner1",
    user: { id: "owner1", name: "אריאל", email: "ariel@triolla.io" },
    org: { id: "org1" },
  },
}));

// Tagged so a test can prove the handler really was built with withTenant — a radar route
// that forgot the wrapper would still pass every payload assertion below.
vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: (h: (req: unknown, ctx: unknown) => unknown) => {
    const wrapped = (req: unknown) => h(req, ctx);
    (wrapped as { __withTenant?: boolean }).__withTenant = true;
    return wrapped;
  },
}));

const packFindMany = vi.fn();
const packFindFirst = vi.fn();
const packUpdate = vi.fn();
const packUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarSourcePack: {
      findMany: (...a: unknown[]) => packFindMany(...a),
      findFirst: (...a: unknown[]) => packFindFirst(...a),
      update: (...a: unknown[]) => packUpdate(...a),
      upsert: (...a: unknown[]) => packUpsert(...a),
    },
  },
}));

const { GET, PATCH } = await import("@/app/api/radar/source-packs/route");

function req(body?: unknown) {
  return {
    nextUrl: { pathname: "/api/radar/source-packs", searchParams: new URLSearchParams() },
    json: async () => body,
  } as unknown as NextRequest;
}

/** A pack of n global + m Israeli sources, all enabled, with `t` taxonomy tags. */
function pack(over: Partial<Record<string, unknown>> = {}, n = 10, m = 10, t = 45) {
  const sources = [
    ...Array.from({ length: n }, (_, i) => ({
      host: `g${i}.com`,
      name: `Global ${i}`,
      lang: "en",
      scope: "global",
      enabled: true,
    })),
    ...Array.from({ length: m }, (_, i) => ({
      host: `il${i}.co.il`,
      name: `ישראלי ${i}`,
      lang: "he",
      scope: "il",
      enabled: true,
    })),
  ];
  return {
    id: "pk1",
    orgId: "org1",
    industryKey: "בנקאות ופיננסים ישראל",
    sources,
    taxonomy: Array.from({ length: t }, (_, i) => ({ tag: `tag-${i}`, label: `תגית ${i}` })),
    createdAt: new Date("2026-08-31T00:00:00Z"),
    updatedAt: new Date("2026-08-31T00:00:00Z"),
    ...over,
  };
}

async function json(res: unknown) {
  return (await (res as Response).json()) as Record<string, never> & Record<string, unknown>;
}

beforeEach(() => {
  for (const m of [packFindMany, packFindFirst, packUpdate, packUpsert]) m.mockReset();
  packFindMany.mockResolvedValue([pack()]);
  packFindFirst.mockResolvedValue(pack());
  packUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...pack(),
    ...args.data,
  }));
  packUpsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
    ...pack(),
    id: "pk-copy",
    ...args.create,
  }));
});

describe("the route is tenant-wrapped", () => {
  it("wraps both handlers in withTenant", () => {
    expect((GET as unknown as { __withTenant?: boolean }).__withTenant).toBe(true);
    expect((PATCH as unknown as { __withTenant?: boolean }).__withTenant).toBe(true);
  });
});

describe("GET /api/radar/source-packs", () => {
  it("returns the org's packs", async () => {
    const body = await json(await GET(req()));
    expect(Array.isArray(body.packs)).toBe(true);
    const packs = body.packs as { industryKey: string; sources: unknown[] }[];
    expect(packs).toHaveLength(1);
    expect(packs[0].industryKey).toBe("בנקאות ופיננסים ישראל");
    expect(packs[0].sources).toHaveLength(20);
  });

  it("asks only for this org's rows and the shared fallbacks — never another org's", async () => {
    await GET(req());
    const where = packFindMany.mock.calls[0][0].where as { OR: { orgId: string | null }[] };
    expect(where.OR).toEqual(expect.arrayContaining([{ orgId: "org1" }, { orgId: null }]));
    // Nothing in the filter may admit a third org's row.
    expect(JSON.stringify(where)).not.toContain("org2");
  });

  it("prefers the org's edited copy over the shared pack for the same industry", async () => {
    packFindMany.mockResolvedValue([
      pack({ id: "shared", orgId: null }),
      pack({ id: "mine", orgId: "org1" }),
    ]);
    const body = await json(await GET(req()));
    const packs = body.packs as { id: string; scope: string }[];
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe("mine");
    expect(packs[0].scope).toBe("org");
  });

  it("reports counts per half, so a human can see the pack's shape at a glance", async () => {
    const body = await json(await GET(req()));
    const packs = body.packs as { counts: Record<string, number> }[];
    expect(packs[0].counts.global).toBe(10);
    expect(packs[0].counts.il).toBe(10);
    expect(packs[0].counts.taxonomy).toBe(45);
  });

  it("marks a full 10+10 pack as complete", async () => {
    const body = await json(await GET(req()));
    const packs = body.packs as { incomplete: boolean; gaps: string[] }[];
    expect(packs[0].incomplete).toBe(false);
    expect(packs[0].gaps).toEqual([]);
  });
});

describe("a pack short of 10+10 is accepted, and flagged", () => {
  it("flags a short pack on GET without dropping it", async () => {
    packFindMany.mockResolvedValue([pack({}, 3, 2, 12)]);
    const body = await json(await GET(req()));
    const packs = body.packs as { incomplete: boolean; gaps: string[]; sources: unknown[] }[];
    expect(packs).toHaveLength(1);
    expect(packs[0].sources).toHaveLength(5);
    expect(packs[0].incomplete).toBe(true);
    // The flag has to say WHAT is missing, in Hebrew — "incomplete: true" alone gives a
    // human nothing to act on.
    expect(packs[0].gaps.join(" ")).toMatch(/גלובל/);
    expect(packs[0].gaps.join(" ")).toMatch(/ישראל/);
  });

  it("SAVES a write that leaves the pack short — the count is a target, not a rule", async () => {
    packFindFirst.mockResolvedValue(pack({}, 3, 2, 12));
    const res = (await PATCH(
      req({ packId: "pk1", action: "toggleSource", host: "g0.com", enabled: false })
    )) as Response;
    expect(res.status).toBe(200);
    expect(packUpdate).toHaveBeenCalled();
    const body = await json(res);
    expect((body.pack as { incomplete: boolean }).incomplete).toBe(true);
  });

  it("does not throw on an empty pack", async () => {
    packFindMany.mockResolvedValue([pack({}, 0, 0, 0)]);
    const res = (await GET(req())) as Response;
    expect(res.status).toBe(200);
    const packs = (await json(res)).packs as { incomplete: boolean }[];
    expect(packs[0].incomplete).toBe(true);
  });
});

describe("PATCH toggles one source's enabled", () => {
  it("turns a source off and leaves the other nineteen alone", async () => {
    const res = (await PATCH(
      req({ packId: "pk1", action: "toggleSource", host: "il3.co.il", enabled: false })
    )) as Response;
    expect(res.status).toBe(200);

    const written = packUpdate.mock.calls[0][0].data.sources as { host: string; enabled: boolean }[];
    expect(written).toHaveLength(20);
    expect(written.find((s) => s.host === "il3.co.il")!.enabled).toBe(false);
    expect(written.filter((s) => s.enabled === false)).toHaveLength(1);
  });

  it("turns a source back on — the off switch is not a delete", async () => {
    packFindFirst.mockResolvedValue(
      pack({
        sources: [{ host: "g0.com", name: "G", lang: "en", scope: "global", enabled: false }],
      })
    );
    await PATCH(req({ packId: "pk1", action: "toggleSource", host: "g0.com", enabled: true }));
    const written = packUpdate.mock.calls[0][0].data.sources as { enabled: boolean }[];
    expect(written[0].enabled).toBe(true);
  });

  it("404s on a host that is not in the pack, rather than silently writing nothing", async () => {
    const res = (await PATCH(
      req({ packId: "pk1", action: "toggleSource", host: "nope.com", enabled: false })
    )) as Response;
    expect(res.status).toBe(404);
    expect(packUpdate).not.toHaveBeenCalled();
  });
});

describe("PATCH edits the taxonomy", () => {
  it("replaces the closed vocabulary with the submitted one", async () => {
    const taxonomy = [
      { tag: "אשראי-צרכני", label: "אשראי צרכני" },
      { tag: "משכנתאות", label: "משכנתאות ודיור" },
    ];
    const res = (await PATCH(req({ packId: "pk1", action: "taxonomy", taxonomy }))) as Response;
    expect(res.status).toBe(200);
    expect(packUpdate.mock.calls[0][0].data.taxonomy).toEqual(taxonomy);
  });

  it("drops a blank or malformed entry instead of writing a tag triage can never echo", async () => {
    await PATCH(
      req({
        packId: "pk1",
        action: "taxonomy",
        taxonomy: [
          { tag: "תשלומים", label: "תשלומים" },
          { tag: "   ", label: "ריק" },
          { tag: "בלי-תווית" },
          "not an object",
        ],
      })
    );
    const written = packUpdate.mock.calls[0][0].data.taxonomy as { tag: string; label: string }[];
    expect(written).toEqual([{ tag: "תשלומים", label: "תשלומים" }]);
  });

  it("dedupes by tag — one tag, one row, or the closed list stops being a list", async () => {
    await PATCH(
      req({
        packId: "pk1",
        action: "taxonomy",
        taxonomy: [
          { tag: "תשלומים", label: "תשלומים" },
          { tag: "תשלומים", label: "תשלומים מיידיים" },
        ],
      })
    );
    const written = packUpdate.mock.calls[0][0].data.taxonomy as unknown[];
    expect(written).toHaveLength(1);
  });

  it("rejects a taxonomy that is not an array", async () => {
    const res = (await PATCH(req({ packId: "pk1", action: "taxonomy", taxonomy: "הכל" }))) as Response;
    expect(res.status).toBe(400);
    expect(packUpdate).not.toHaveBeenCalled();
  });
});

describe("PATCH replaces the source list", () => {
  it("accepts a whole new list, so add/remove/replace is one UI action", async () => {
    const sources = [
      { host: "globes.co.il", name: "גלובס", lang: "he", scope: "il", enabled: true },
      { host: "finextra.com", name: "Finextra", lang: "en", scope: "global", enabled: false },
    ];
    const res = (await PATCH(req({ packId: "pk1", action: "sources", sources }))) as Response;
    expect(res.status).toBe(200);
    expect(packUpdate.mock.calls[0][0].data.sources).toEqual(sources);
  });

  it("rejects a source with no host — the host is the dedupe key and the gift-gate key", async () => {
    const res = (await PATCH(
      req({ packId: "pk1", action: "sources", sources: [{ name: "בלי בית", lang: "he", scope: "il" }] })
    )) as Response;
    expect(res.status).toBe(400);
    expect(packUpdate).not.toHaveBeenCalled();
  });
});

describe("withTenant scoping is enforced on the write", () => {
  it("looks the pack up inside this org's reach only", async () => {
    await PATCH(req({ packId: "pk1", action: "toggleSource", host: "g0.com", enabled: false }));
    const where = packFindFirst.mock.calls[0][0].where as {
      id: string;
      OR: { orgId: string | null }[];
    };
    expect(where.id).toBe("pk1");
    expect(where.OR).toEqual(expect.arrayContaining([{ orgId: "org1" }, { orgId: null }]));
  });

  it("404s on another org's pack instead of editing it", async () => {
    packFindFirst.mockResolvedValue(null);
    const res = (await PATCH(
      req({ packId: "someone-elses", action: "toggleSource", host: "g0.com", enabled: false })
    )) as Response;
    expect(res.status).toBe(404);
    expect(packUpdate).not.toHaveBeenCalled();
    expect(packUpsert).not.toHaveBeenCalled();
  });

  it("copies a SHARED pack into this org instead of rewriting everyone's sources", async () => {
    packFindFirst.mockResolvedValue(pack({ id: "shared", orgId: null }));
    const res = (await PATCH(
      req({ packId: "shared", action: "toggleSource", host: "g0.com", enabled: false })
    )) as Response;
    expect(res.status).toBe(200);

    // The shared row is never updated in place.
    expect(packUpdate).not.toHaveBeenCalled();
    const args = packUpsert.mock.calls[0][0] as {
      where: { orgId_industryKey: { orgId: string; industryKey: string } };
      create: { orgId: string; sources: { host: string; enabled: boolean }[] };
    };
    expect(args.where.orgId_industryKey).toEqual({
      orgId: "org1",
      industryKey: "בנקאות ופיננסים ישראל",
    });
    expect(args.create.orgId).toBe("org1");
    expect(args.create.sources.find((s) => s.host === "g0.com")!.enabled).toBe(false);
  });
});

describe("PATCH input guards", () => {
  it("400s with no packId", async () => {
    const res = (await PATCH(req({ action: "toggleSource", host: "g0.com", enabled: false }))) as Response;
    expect(res.status).toBe(400);
  });

  it("400s on an unknown action rather than guessing what the caller meant", async () => {
    const res = (await PATCH(req({ packId: "pk1", action: "burn-it-down" }))) as Response;
    expect(res.status).toBe(400);
    expect(packUpdate).not.toHaveBeenCalled();
  });

  it("400s on a body that is not JSON at all", async () => {
    const bad = {
      nextUrl: { pathname: "/api/radar/source-packs" },
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as NextRequest;
    const res = (await PATCH(bad)) as Response;
    expect(res.status).toBe(400);
  });
});

describe("the pack's headline", () => {
  /**
   * `industryKey` is `normalizeIndustryKey`'s output — a token-sorted slug, and for the
   * banking family literally the English "banking finance". Heading the screen with that
   * would put an English slug above a Hebrew page, so the label is recovered from the
   * seed (and then from the industry family) rather than stored.
   */
  it("shows the seed's Hebrew label for a normalised industry key", async () => {
    packFindMany.mockResolvedValue([pack({ industryKey: "banking finance" })]);
    const packs = (await json(await GET(req()))).packs as { label: string; industryKey: string }[];
    expect(packs[0].industryKey).toBe("banking finance");
    expect(packs[0].label).toBe("בנקאות ופיננסים — ישראל");
  });

  it("falls back to the key itself for an industry nobody has seeded", async () => {
    packFindMany.mockResolvedValue([pack({ industryKey: "aviation" })]);
    const packs = (await json(await GET(req()))).packs as { label: string }[];
    expect(packs[0].label).toBe("aviation");
  });
});
