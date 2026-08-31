import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { normalizeAxisKey } from "@/lib/tech-radar/axis";

/**
 * Manual person tags — the other half of muting.
 *
 * Muting lets a human SUBTRACT from the model; until this route there was no way to ADD
 * ("he always cares about cyber regulation"). What makes the addition worth anything is
 * that it survives a rebuild, and the only marker carrying that promise is
 * `PersonAxis.source: "MANUAL"` — so these tests pin the source, not just the 200.
 */

const { ctx } = vi.hoisted(() => ({
  ctx: { effectiveUserId: "owner1", user: { name: "יובל", email: "yuval@triolla.io" }, org: { id: "org1" } },
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

const contactFindFirst = vi.fn();
const contactFindMany = vi.fn();
const axisUpsert = vi.fn();
const personAxisFindFirst = vi.fn();
const personAxisCreate = vi.fn();
const personAxisUpdate = vi.fn();
const companyFindMany = vi.fn();
const draftFindMany = vi.fn();
const draftGroupBy = vi.fn();
const matchGroupBy = vi.fn();
const sentGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      findMany: (...a: unknown[]) => contactFindMany(...a),
    },
    radarAxis: { upsert: (...a: unknown[]) => axisUpsert(...a) },
    personAxis: {
      findFirst: (...a: unknown[]) => personAxisFindFirst(...a),
      create: (...a: unknown[]) => personAxisCreate(...a),
      update: (...a: unknown[]) => personAxisUpdate(...a),
    },
    trackedCompany: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    radarDraft: {
      findMany: (...a: unknown[]) => draftFindMany(...a),
      groupBy: (...a: unknown[]) => draftGroupBy(...a),
    },
    axisMatch: { groupBy: (...a: unknown[]) => matchGroupBy(...a) },
    sentMessage: { groupBy: (...a: unknown[]) => sentGroupBy(...a) },
  },
}));
vi.mock("@/inngest/client", () => ({ inngest: { send: vi.fn() } }));

const { POST, DELETE } = await import("@/app/api/radar/people/[contactId]/tags/route");
const { GET: getPerson } = await import("@/app/api/radar/people/[contactId]/route");

/** The route's own path shape: one segment DEEPER than the sibling person route. */
function req(body?: unknown, pathname = "/api/radar/people/ct1/tags") {
  return { nextUrl: { pathname }, json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  for (const m of [
    contactFindFirst, contactFindMany, axisUpsert, personAxisFindFirst, personAxisCreate,
    personAxisUpdate, companyFindMany, draftFindMany, draftGroupBy, matchGroupBy, sentGroupBy,
  ]) {
    m.mockReset();
  }
  contactFindMany.mockResolvedValue([]);
  companyFindMany.mockResolvedValue([]);
  draftFindMany.mockResolvedValue([]);
  draftGroupBy.mockResolvedValue([]);
  matchGroupBy.mockResolvedValue([]);
  sentGroupBy.mockResolvedValue([]);
  contactFindFirst.mockResolvedValue({ id: "ct1", personProfile: { id: "pp1" } });
  axisUpsert.mockResolvedValue({ id: "ax9" });
  personAxisFindFirst.mockResolvedValue(null);
  personAxisCreate.mockResolvedValue({ id: "pa9" });
  personAxisUpdate.mockResolvedValue({});
});

describe("POST /api/radar/people/[contactId]/tags", () => {
  it("is wrapped in withTenant", () => {
    expect((POST as unknown as { __withTenant?: boolean }).__withTenant).toBe(true);
    expect((DELETE as unknown as { __withTenant?: boolean }).__withTenant).toBe(true);
  });

  it("reads the contact id from the second-from-last segment, not the literal 'tags'", async () => {
    await POST(req({ name: "One Zero" }));
    expect(contactFindFirst.mock.calls[0][0].where.id).toBe("ct1");
  });

  it("scopes the contact to the signed-in owner", async () => {
    await POST(req({ name: "One Zero" }));
    expect(contactFindFirst.mock.calls[0][0].where.ownerId).toBe("owner1");
  });

  it("creates a PERSON_ENTITY axis keyed to this person, labelled as typed", async () => {
    const res = (await POST(req({ name: "One Zero", aliases: ["וואן זירו"] }))) as Response;
    expect(res.status).toBe(200);

    const args = axisUpsert.mock.calls[0][0];
    expect(args.where).toEqual({ orgId_key: { orgId: "org1", key: `entity:pp1:${normalizeAxisKey("One Zero")}` } });
    expect(args.create).toMatchObject({
      orgId: "org1",
      key: `entity:pp1:${normalizeAxisKey("One Zero")}`,
      // Label is what the human typed — the key is normalised, the label never is.
      label: "One Zero",
      kind: "PERSON_ENTITY",
    });
  });

  it("links it with source MANUAL — the contract that survives a rebuild", async () => {
    await POST(req({ name: "רגולציית סייבר", aliases: ["cyber regulation"] }));
    expect(personAxisCreate.mock.calls[0][0].data).toMatchObject({
      personProfileId: "pp1",
      axisId: "ax9",
      weight: 1,
      source: "MANUAL",
      evidence: { aliases: ["cyber regulation"], tagKind: "manual" },
    });
    // rationale is NOT NULL in the schema; a link with no reason cannot be written.
    expect(typeof personAxisCreate.mock.calls[0][0].data.rationale).toBe("string");
  });

  it("defaults aliases to an empty list and drops non-strings", async () => {
    await POST(req({ name: "One Zero", aliases: ["ok", 7, null] }));
    expect(personAxisCreate.mock.calls[0][0].data.evidence).toEqual({ aliases: ["ok"], tagKind: "manual" });
  });

  it("400s on an empty name and spends no write", async () => {
    const res = (await POST(req({ name: "   " }))) as Response;
    expect(res.status).toBe(400);
    expect(axisUpsert).not.toHaveBeenCalled();
    expect(personAxisCreate).not.toHaveBeenCalled();
  });

  it("400s on a name that normalises to nothing — 'entity:pp1:' would be one shared axis", async () => {
    const res = (await POST(req({ name: "the of in" }))) as Response;
    expect(res.status).toBe(400);
    expect(axisUpsert).not.toHaveBeenCalled();
  });

  it("404s for a contact that is not this owner's", async () => {
    contactFindFirst.mockResolvedValue(null);
    const res = (await POST(req({ name: "One Zero" }))) as Response;
    expect(res.status).toBe(404);
    expect(axisUpsert).not.toHaveBeenCalled();
  });

  it("404s when the person has no PersonProfile yet — nothing to hang an axis off", async () => {
    contactFindFirst.mockResolvedValue({ id: "ct1", personProfile: null });
    const res = (await POST(req({ name: "One Zero" }))) as Response;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_person_profile" });
    expect(axisUpsert).not.toHaveBeenCalled();
  });

  it("409s when this person already carries that tag", async () => {
    personAxisFindFirst.mockResolvedValue({ id: "pa1" });
    const res = (await POST(req({ name: "One Zero" }))) as Response;
    expect(res.status).toBe(409);
    expect(personAxisCreate).not.toHaveBeenCalled();
  });

  it("409s rather than 500s when a double-click races into the unique constraint", async () => {
    personAxisCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const res = (await POST(req({ name: "One Zero" }))) as Response;
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/radar/people/[contactId]/tags", () => {
  it("mutes the link instead of deleting it — a deleted axis takes its reason with it", async () => {
    personAxisFindFirst.mockResolvedValue({ id: "pa9" });
    const res = (await DELETE(req({ axisId: "pa9" }))) as Response;
    expect(res.status).toBe(200);
    expect(personAxisUpdate.mock.calls[0][0]).toEqual({
      where: { id: "pa9" },
      data: { mutedAt: expect.any(Date) },
    });
  });

  it("scopes the link to this person's profile — another person's axis is not mutable here", async () => {
    personAxisFindFirst.mockResolvedValue({ id: "pa9" });
    await DELETE(req({ axisId: "pa9" }));
    expect(personAxisFindFirst.mock.calls[0][0].where.personProfileId).toBe("pp1");
  });

  it("404s for a link that is not this person's", async () => {
    personAxisFindFirst.mockResolvedValue(null);
    const res = (await DELETE(req({ axisId: "someone-elses" }))) as Response;
    expect(res.status).toBe(404);
    expect(personAxisUpdate).not.toHaveBeenCalled();
  });

  it("400s without an axisId", async () => {
    const res = (await DELETE(req({}))) as Response;
    expect(res.status).toBe(400);
    expect(personAxisUpdate).not.toHaveBeenCalled();
  });
});

/**
 * The person page can only mark a manual tag if the payload it reads distinguishes one.
 * The sibling route translates the enum into screen words once; MANUAL must have its own
 * word there rather than falling through to "role", or the user's own correction reads as
 * the model's guess.
 */
describe("GET /api/radar/people/[contactId] — manual provenance in the payload", () => {
  function withAxes(axes: unknown[]) {
    return {
      id: "ct1", fullName: "Pazit Levy", currentTitle: "CMO", currentCompany: "בנק לאומי",
      companyId: null, linkedinUrl: null, messageLanguage: "he", radarInclude: true,
      radarAddedAt: new Date("2026-08-24T11:00:00Z"),
      personProfile: { id: "pp1", axes },
    };
  }

  it("gives a MANUAL link its own source word, not the enum and not 'role'", async () => {
    contactFindFirst.mockResolvedValue(
      withAxes([
        { id: "pa1", mutedAt: null, source: "ROLE_COMPANY", axis: { id: "ax1", label: "חוויית לקוח דיגיטלית" } },
        { id: "pa2", mutedAt: null, source: "MANUAL", axis: { id: "ax2", label: "רגולציית סייבר" } },
        { id: "pa3", mutedAt: null, source: "PERSON_ENTITY", axis: { id: "ax3", label: "One Zero" } },
      ])
    );
    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.axes.map((a: { source: string }) => a.source)).toEqual(["role", "manual", "entity"]);
    expect(JSON.stringify(body)).not.toContain("MANUAL");
  });

  it("a muted manual tag is still returned, flagged — the correction stays undoable", async () => {
    contactFindFirst.mockResolvedValue(
      withAxes([
        {
          id: "pa2", mutedAt: new Date("2026-08-30T00:00:00Z"), source: "MANUAL",
          axis: { id: "ax2", label: "רגולציית סייבר" },
        },
      ])
    );
    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.axes).toHaveLength(1);
    expect(body.axes[0]).toMatchObject({ source: "manual", muted: true, label: "רגולציית סייבר" });
  });
});
