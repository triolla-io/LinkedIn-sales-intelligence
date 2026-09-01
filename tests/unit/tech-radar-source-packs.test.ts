import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pack resolution: which source packs an org's tracked people actually need.
 *
 * Two live failures drive these tests.
 *
 * 1. Gil Tamir carries TWO duplicate INDUSTRY axes — "Financial Services / שירותים
 *    פיננסיים" and "Israeli financial services / שירותים פיננסיים בישראל" — because an
 *    industry's name was never normalised the way an axis label is. Unnormalised, those
 *    two would ask for two packs for one industry, and the second would not exist.
 *
 * 2. Silent empties. On 2026-08-27 a mass drop went unnoticed, and a "0 נמצאו" run turned
 *    out to be 25 people silently title-filtered. An industry with no pack must therefore
 *    come back NAMED in the return value, not merely absent from it.
 */

const axisFindMany = vi.fn();
const packFindMany = vi.fn();
const packUpsert = vi.fn();
const packFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: { findMany: (...a: unknown[]) => axisFindMany(...a) },
    radarSourcePack: {
      findMany: (...a: unknown[]) => packFindMany(...a),
      upsert: (...a: unknown[]) => packUpsert(...a),
      findUnique: (...a: unknown[]) => packFindUnique(...a),
    },
  },
}));

const { BANKING_IL_PACK } = await import("@/lib/tech-radar/sources");
const { normalizeIndustryKey, resolvePacksForOrg, ensureSeedPack } = await import(
  "@/lib/tech-radar/source-packs"
);

/** The canonical key every banking/financial-services spelling must land on. */
const BANK_KEY = normalizeIndustryKey("בנקאות ופיננסים ישראל");

function axis(label: string, people: { personProfileId: string; mutedAt?: Date | null }[]) {
  return {
    id: `ax-${label}`,
    label,
    people: people.map((p) => ({ personProfileId: p.personProfileId })),
  };
}

function packRow(over: Record<string, unknown> = {}) {
  return {
    id: "row1",
    orgId: null as string | null,
    industryKey: BANK_KEY,
    sources: BANKING_IL_PACK.sources,
    taxonomy: BANKING_IL_PACK.taxonomy,
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  axisFindMany.mockReset();
  packFindMany.mockReset();
  packUpsert.mockReset();
  packFindUnique.mockReset();
  axisFindMany.mockResolvedValue([]);
  packFindMany.mockResolvedValue([]);
  packFindUnique.mockResolvedValue(null);
  packUpsert.mockImplementation(async (args: { create: unknown }) => args.create);
});

describe("normalizeIndustryKey", () => {
  it("collapses Gil Tamir's two duplicate industry axes onto ONE key", () => {
    const a = normalizeIndustryKey("Financial Services / שירותים פיננסיים");
    const b = normalizeIndustryKey("Israeli financial services / שירותים פיננסיים בישראל");
    expect(a).not.toBe("");
    expect(a).toBe(b);
  });

  it("keys a bilingual industry name and its English half the same", () => {
    expect(normalizeIndustryKey("בנקאות ישראל / Israeli banking")).toBe(
      normalizeIndustryKey("Israeli banking")
    );
  });

  it("keys the seeded pack's own industry name the same as both of those", () => {
    expect(normalizeIndustryKey(BANKING_IL_PACK.industryKey)).toBe(
      normalizeIndustryKey("Israeli banking")
    );
    expect(normalizeIndustryKey("Financial Services / שירותים פיננסיים")).toBe(
      normalizeIndustryKey(BANKING_IL_PACK.industryKey)
    );
  });

  it("is token-sorted, so word order cannot make two keys (normalizeAxisKey's discipline)", () => {
    expect(normalizeIndustryKey("banking and finance")).toBe(normalizeIndustryKey("finance, banking"));
  });

  it("strips the 'ענף: ' prefix ensureIndustryAxis writes onto an INDUSTRY axis label", () => {
    expect(normalizeIndustryKey("ענף: בנקאות ישראל")).toBe(normalizeIndustryKey("בנקאות ישראל"));
  });

  it("returns empty for a non-string or an all-filler name, never a shared degenerate key", () => {
    expect(normalizeIndustryKey(undefined as unknown as string)).toBe("");
    expect(normalizeIndustryKey("   ")).toBe("");
    expect(normalizeIndustryKey("the industry sector")).toBe("");
  });

  it("does NOT fold insurance into the banking family (the Phoenix→Leumi leak)", () => {
    expect(normalizeIndustryKey("ביטוח ישראל / Israeli insurance")).not.toBe(BANK_KEY);
  });
});

describe("resolvePacksForOrg", () => {
  it("resolves one pack for an org whose people all work at banks", async () => {
    axisFindMany.mockResolvedValue([
      axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }, { personProfileId: "p2" }]),
    ]);
    packFindMany.mockResolvedValue([packRow()]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs).toHaveLength(1);
    expect(out.packs[0].industryKey).toBe(BANK_KEY);
    expect(out.packs[0].sources.length).toBeGreaterThan(0);
    expect(out.unresolved).toEqual([]);
  });

  it("resolves two packs for an org with two industries", async () => {
    const insuranceKey = normalizeIndustryKey("ביטוח ישראל");
    axisFindMany.mockResolvedValue([
      axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }]),
      axis("ענף: ביטוח ישראל", [{ personProfileId: "p2" }]),
    ]);
    packFindMany.mockResolvedValue([
      packRow(),
      packRow({
        id: "row2",
        industryKey: insuranceKey,
        sources: [{ host: "globes.co.il", name: "גלובס", lang: "he", scope: "il", enabled: true }],
        taxonomy: [{ tag: "ביטוח-חיים", label: "ביטוח חיים" }],
      }),
    ]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs.map((p) => p.industryKey).sort()).toEqual([BANK_KEY, insuranceKey].sort());
    expect(out.unresolved).toEqual([]);
  });

  it("REPORTS an industry with no pack instead of returning quietly fewer packs", async () => {
    axisFindMany.mockResolvedValue([
      axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }]),
      axis("ענף: קמעונאות מזון", [{ personProfileId: "p2" }, { personProfileId: "p3" }]),
    ]);
    packFindMany.mockResolvedValue([packRow()]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs).toHaveLength(1);
    expect(out.unresolved).toHaveLength(1);
    expect(out.unresolved[0]).toMatchObject({
      industryKey: normalizeIndustryKey("קמעונאות מזון"),
      reason: "no_pack",
      people: 2,
    });
    // The human-facing label survives, so the report can name the industry in Hebrew.
    expect(out.unresolved[0].labels).toContain("ענף: קמעונאות מזון");
  });

  it("resolves Gil Tamir's two duplicate industry axes to a single pack", async () => {
    axisFindMany.mockResolvedValue([
      axis("ענף: Financial Services / שירותים פיננסיים", [{ personProfileId: "gil" }]),
      axis("ענף: Israeli financial services / שירותים פיננסיים בישראל", [{ personProfileId: "gil" }]),
    ]);
    packFindMany.mockResolvedValue([packRow()]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs).toHaveLength(1);
    expect(out.unresolved).toEqual([]);
    // One person, counted once, not twice.
    expect(out.industries).toHaveLength(1);
    expect(out.industries[0].people).toBe(1);
  });

  it("does not treat a muted-only industry as represented, and still reports it", async () => {
    axisFindMany.mockResolvedValue([axis("ענף: בנקאות ישראל", [])]);
    packFindMany.mockResolvedValue([packRow()]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs).toEqual([]);
    expect(out.noSubscribers).toHaveLength(1);
    expect(out.noSubscribers[0].industryKey).toBe(BANK_KEY);
  });

  it("asks the database only for non-muted subscribers of ACTIVE industry axes", async () => {
    await resolvePacksForOrg("org1");
    const args = axisFindMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ orgId: "org1", kind: "INDUSTRY", status: "ACTIVE" });
    expect(args.select.people.where).toEqual({ mutedAt: null });
  });

  it("prefers the org's own edited pack over the global fallback", async () => {
    axisFindMany.mockResolvedValue([axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }])]);
    packFindMany.mockResolvedValue([
      packRow({ id: "global", orgId: null, updatedAt: new Date("2026-08-30T00:00:00Z") }),
      packRow({
        id: "mine",
        orgId: "org1",
        updatedAt: new Date("2026-08-02T00:00:00Z"),
        sources: [{ host: "calcalist.co.il", name: "כלכליסט", lang: "he", scope: "il", enabled: true }],
      }),
    ]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs).toHaveLength(1);
    expect(out.packs[0].sources.map((s) => s.host)).toEqual(["calcalist.co.il"]);
  });

  it("takes the NEWEST global pack when two rows share orgId null", async () => {
    axisFindMany.mockResolvedValue([axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }])]);
    packFindMany.mockResolvedValue([
      packRow({
        id: "old",
        updatedAt: new Date("2026-07-01T00:00:00Z"),
        sources: [{ host: "old.example", name: "old", lang: "en", scope: "global", enabled: true }],
      }),
      packRow({
        id: "new",
        updatedAt: new Date("2026-08-20T00:00:00Z"),
        sources: [{ host: "new.example", name: "new", lang: "en", scope: "global", enabled: true }],
      }),
    ]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs[0].sources.map((s) => s.host)).toEqual(["new.example"]);
  });

  it("reports a pack whose sources are all malformed as unresolved, not as a working pack", async () => {
    axisFindMany.mockResolvedValue([axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }])]);
    packFindMany.mockResolvedValue([
      packRow({ sources: [{ name: "no host" }, "junk", null], taxonomy: BANKING_IL_PACK.taxonomy }),
    ]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs).toEqual([]);
    expect(out.unresolved).toHaveLength(1);
    expect(out.unresolved[0].reason).toBe("pack_empty");
  });

  it("reports a pack with an empty taxonomy as unresolved — a tag overlap of nothing scores zero for everybody", async () => {
    axisFindMany.mockResolvedValue([axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }])]);
    packFindMany.mockResolvedValue([packRow({ taxonomy: [] })]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs).toEqual([]);
    expect(out.unresolved[0].reason).toBe("pack_empty");
  });

  it("reports an axis label that normalises to no industry at all, rather than dropping it", async () => {
    axisFindMany.mockResolvedValue([axis("ענף: ", [{ personProfileId: "p1" }])]);

    const out = await resolvePacksForOrg("org1");
    expect(out.industries).toEqual([]);
    expect(out.unkeyed).toEqual([{ axisId: "ax-ענף: ", label: "ענף: " }]);
  });

  it("drops a disabled source but keeps the pack", async () => {
    axisFindMany.mockResolvedValue([axis("ענף: בנקאות ישראל", [{ personProfileId: "p1" }])]);
    packFindMany.mockResolvedValue([
      packRow({
        sources: [
          { host: "globes.co.il", name: "גלובס", lang: "he", scope: "il", enabled: true },
          { host: "off.example", name: "off", lang: "en", scope: "global", enabled: false },
        ],
      }),
    ]);

    const out = await resolvePacksForOrg("org1");
    expect(out.packs[0].sources.map((s) => s.host)).toEqual(["globes.co.il"]);
  });
});

describe("ensureSeedPack", () => {
  it("writes the banking pack under the NORMALISED industry key when absent", async () => {
    const out = await ensureSeedPack("org1");
    expect(packUpsert).toHaveBeenCalledTimes(1);
    const args = packUpsert.mock.calls[0][0];
    expect(args.where).toEqual({ orgId_industryKey: { orgId: "org1", industryKey: BANK_KEY } });
    expect(args.create.industryKey).toBe(BANK_KEY);
    expect(args.create.sources).toHaveLength(BANKING_IL_PACK.sources.length);
    expect(out).toMatchObject({ industryKey: BANK_KEY, created: true });
  });

  it("never overwrites an existing row — a human's source edits must survive a re-seed", async () => {
    packFindUnique.mockResolvedValue(packRow({ orgId: "org1" }));
    const out = await ensureSeedPack("org1");
    expect(out.created).toBe(false);
    // An upsert may still run (it is the idempotent write), but it must not carry an update.
    for (const call of packUpsert.mock.calls) expect(call[0].update).toEqual({});
  });

  it("is idempotent: two calls leave one row", async () => {
    await ensureSeedPack("org1");
    packFindUnique.mockResolvedValue(packRow({ orgId: "org1" }));
    await ensureSeedPack("org1");
    for (const call of packUpsert.mock.calls) {
      expect(call[0].where).toEqual({ orgId_industryKey: { orgId: "org1", industryKey: BANK_KEY } });
    }
  });
});
