import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The people API. What the tests pin down:
 * - adding a person fires the SCOPED prepare pipeline, once (a double-click must not
 *   pay for research twice)
 * - muting an axis never deletes it — the learning trail has to survive
 * - axis provenance reaches the screen in human words, never the enum name
 */

// A mutable ctx so pilot-gate tests can swap the requesting user's email between the
// owner (held from) and a reviewer (sees held rows too), same pattern as
// radar-approvals-route.test.ts.
const { ctx } = vi.hoisted(() => ({
  ctx: { effectiveUserId: "owner1", user: { name: "יובל", email: "yuval@triolla.io" }, org: { id: "org1" } },
}));

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      h(req, ctx),
}));

const contactFindMany = vi.fn();
const contactFindFirst = vi.fn();
const contactUpdate = vi.fn();
const companyFindMany = vi.fn();
const draftGroupBy = vi.fn();
const draftFindMany = vi.fn();
const matchGroupBy = vi.fn();
const sentGroupBy = vi.fn();
const personAxisFindFirst = vi.fn();
const personAxisUpdate = vi.fn();
const send = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
    trackedCompany: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    radarDraft: {
      groupBy: (...a: unknown[]) => draftGroupBy(...a),
      findMany: (...a: unknown[]) => draftFindMany(...a),
    },
    axisMatch: { groupBy: (...a: unknown[]) => matchGroupBy(...a) },
    sentMessage: { groupBy: (...a: unknown[]) => sentGroupBy(...a) },
    personAxis: {
      findFirst: (...a: unknown[]) => personAxisFindFirst(...a),
      update: (...a: unknown[]) => personAxisUpdate(...a),
    },
  },
}));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));

const { GET: listPeople, POST: addPerson } = await import("@/app/api/radar/people/route");
const { GET: getPerson, PATCH: patchPerson } = await import(
  "@/app/api/radar/people/[contactId]/route"
);

function req(body?: unknown, pathname = "/api/radar/people") {
  return { nextUrl: { pathname }, json: async () => body } as unknown as NextRequest;
}

function radarContact(over: Record<string, unknown> = {}) {
  return {
    id: "ct1",
    fullName: "Avigal Soreq",
    currentTitle: "CEO",
    currentCompany: "Delek US Holdings",
    companyId: null,
    linkedinUrl: "https://linkedin.com/in/avigal",
    messageLanguage: "he",
    radarInclude: true,
    radarAddedAt: new Date("2026-08-24T11:00:00Z"),
    personProfile: {
      id: "pp1",
      axes: [
        {
          id: "pa1",
          mutedAt: null,
          source: "ROLE_COMPANY",
          axis: { id: "ax1", label: "חבות RIN" },
        },
        {
          id: "pa2",
          mutedAt: new Date("2026-08-20T00:00:00Z"),
          source: "COMPANY_MONITOR",
          axis: { id: "ax2", label: "מרווחי זיקוק" },
        },
      ],
    },
    ...over,
  };
}

let prevPilotHold: string | undefined;

beforeEach(() => {
  for (const m of [
    contactFindMany, contactFindFirst, contactUpdate, companyFindMany, draftGroupBy,
    draftFindMany, matchGroupBy, sentGroupBy, personAxisFindFirst, personAxisUpdate, send,
  ]) m.mockReset();
  contactFindMany.mockResolvedValue([]);
  companyFindMany.mockResolvedValue([{ id: "tc1", name: "Delek US Holdings", aliases: [], status: "ACTIVE", profileError: null }]);
  draftGroupBy.mockResolvedValue([]);
  draftFindMany.mockResolvedValue([]);
  matchGroupBy.mockResolvedValue([]);
  sentGroupBy.mockResolvedValue([]);
  contactUpdate.mockResolvedValue({});
  ctx.user.email = "yuval@triolla.io";
  prevPilotHold = process.env.RADAR_PILOT_HOLD;
  delete process.env.RADAR_PILOT_HOLD;
});

afterEach(() => {
  if (prevPilotHold === undefined) delete process.env.RADAR_PILOT_HOLD;
  else process.env.RADAR_PILOT_HOLD = prevPilotHold;
});

describe("GET /api/radar/people", () => {
  it("lists this owner's radar people", async () => {
    contactFindMany.mockResolvedValueOnce([radarContact()]);
    const body = await ((await listPeople(req())) as Response).json();
    expect(body.people).toHaveLength(1);
    expect(body.people[0].contactId).toBe("ct1");
    for (const call of contactFindMany.mock.calls) {
      expect(call[0].where.ownerId).toBe("owner1");
    }
  });

  // Candidates moved to ./candidates so they can be searched in the database. This list
  // polls while someone is being prepared and must not carry an address book with it.
  it("does not ship the address book with the polled list", async () => {
    contactFindMany.mockResolvedValueOnce([radarContact()]);
    const body = await ((await listPeople(req())) as Response).json();
    expect(body.candidates).toBeUndefined();
    expect(contactFindMany).toHaveBeenCalledTimes(1);
  });

  it("counts only non-muted axes — a muted one is not something he is watched for", async () => {
    contactFindMany.mockResolvedValueOnce([radarContact()]).mockResolvedValueOnce([]);
    const body = await ((await listPeople(req())) as Response).json();
    expect(body.people[0].axisCount).toBe(1);
    expect(body.people[0].prep.ready).toBe(true);
  });

  /**
   * 2026-08-26 review, Important 2. The industry net is a shared layer-1 axis, not a
   * subject — a person subscribed to nothing but their employer's industry net has NOT
   * been modelled, and must not read as `ready` (with "X תחומי עניין נבנו" / "ייכנס
   * לסריקה הקרובה") the way a genuinely modelled person does. Before this fix,
   * derivePrepStatus's `modelled = hasProfile && axisCount > 0` counted the industry
   * axis the same as any other, so this exact fixture misread as ready.
   */
  it("a person modelled only by the shared industry net is not reported ready", async () => {
    contactFindMany
      .mockResolvedValueOnce([
        radarContact({
          personProfile: {
            id: "pp1",
            axes: [
              { id: "pa3", mutedAt: null, source: "INDUSTRY", axis: { id: "ax3", label: "ענף: בנקאות ישראל" } },
            ],
          },
        }),
      ])
      .mockResolvedValueOnce([]);
    const body = await ((await listPeople(req())) as Response).json();
    // The industry net is a real, live axis — it still counts toward the display total...
    expect(body.people[0].axisCount).toBe(1);
    // ...but it is not one of THIS person's own subjects, so readiness must not flip on
    // it alone.
    expect(body.people[0].prep.ready).toBe(false);
  });
});

describe("POST /api/radar/people", () => {
  it("marks the person, stamps radarAddedAt and fires the scoped prepare", async () => {
    contactFindFirst.mockResolvedValue({ id: "ct5", radarInclude: false });
    const res = (await addPerson(req({ contactId: "ct5" }))) as Response;
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).toMatchObject({
      radarInclude: true,
      radarAddedAt: expect.any(Date),
    });
    expect(send).toHaveBeenCalledWith({
      name: "radar.person.prepare",
      data: { orgId: "org1", ownerId: "owner1", contactId: "ct5" },
    });
  });

  it("adding someone already tracked does not re-fire the pipeline", async () => {
    contactFindFirst.mockResolvedValue({ id: "ct1", radarInclude: true });
    const res = (await addPerson(req({ contactId: "ct1" }))) as Response;
    expect(res.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });

  it("retry re-fires prepare and restarts the stall clock", async () => {
    contactFindFirst.mockResolvedValue({ id: "ct1", radarInclude: true });
    const res = (await addPerson(req({ contactId: "ct1", retry: true }))) as Response;
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).toMatchObject({ radarAddedAt: expect.any(Date) });
    expect(send).toHaveBeenCalled();
  });

  it("a contact of another owner 404s and spends nothing", async () => {
    contactFindFirst.mockResolvedValue(null);
    const res = (await addPerson(req({ contactId: "nope" }))) as Response;
    expect(res.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("GET /api/radar/people/[contactId]", () => {
  it("returns axis provenance in human words, never the enum", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.axes.map((a: { source: string }) => a.source)).toEqual(["role", "company"]);
    expect(JSON.stringify(body)).not.toContain("ROLE_COMPANY");
  });

  it("a muted axis is returned, flagged — never hidden", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.axes).toHaveLength(2);
    expect(body.axes[1].muted).toBe(true);
  });

  it("a person of another owner 404s", async () => {
    contactFindFirst.mockResolvedValue(null);
    const res = (await getPerson(req(undefined, "/api/radar/people/nope"))) as Response;
    expect(res.status).toBe(404);
  });

  /**
   * The research may actively find there are no direct competitors (a state monopoly).
   * That finding is shown on the person page WITH its reason, so a human can correct
   * the model when it is wrong — a silent empty list is indistinguishable from a
   * forgotten field.
   */
  it("surfaces the employer's explicit no-competitors finding with its reason", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    companyFindMany.mockResolvedValue([
      {
        id: "tc1", name: "Delek US Holdings", aliases: [], status: "ACTIVE", profileError: null,
        companyId: null,
        profile: { noClearCompetitors: true, noCompetitorsReason: "מונופול ממשלתי בתחומו" },
      },
    ]);
    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.employerFinding).toEqual({
      noClearCompetitors: true,
      reason: "מונופול ממשלתי בתחומו",
    });
  });

  it("returns no employer finding when competitors were found", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    companyFindMany.mockResolvedValue([
      {
        id: "tc1", name: "Delek US Holdings", aliases: [], status: "ACTIVE", profileError: null,
        companyId: null,
        profile: { noClearCompetitors: false, namedCompetitors: ["Valero"] },
      },
    ]);
    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.employerFinding).toBeNull();
  });
});

describe("PATCH /api/radar/people/[contactId]", () => {
  it("muting an axis sets mutedAt instead of deleting it", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    personAxisFindFirst.mockResolvedValue({ id: "pa1" });
    const res = (await patchPerson(
      req({ action: "muteAxis", personAxisId: "pa1", muted: true }, "/api/radar/people/ct1")
    )) as Response;
    expect(res.status).toBe(200);
    expect(personAxisUpdate.mock.calls[0][0].data).toEqual({ mutedAt: expect.any(Date) });
  });

  it("unmuting clears the flag", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    personAxisFindFirst.mockResolvedValue({ id: "pa2" });
    await patchPerson(req({ action: "muteAxis", personAxisId: "pa2", muted: false }, "/api/radar/people/ct1"));
    expect(personAxisUpdate.mock.calls[0][0].data).toEqual({ mutedAt: null });
  });

  it("refuses an axis that is not this person's", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    personAxisFindFirst.mockResolvedValue(null);
    const res = (await patchPerson(
      req({ action: "muteAxis", personAxisId: "someone-elses", muted: true }, "/api/radar/people/ct1")
    )) as Response;
    expect(res.status).toBe(404);
    expect(personAxisUpdate).not.toHaveBeenCalled();
  });

  it("language accepts only he/en", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    const ok = (await patchPerson(req({ action: "language", value: "en" }, "/api/radar/people/ct1"))) as Response;
    expect(ok.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).toEqual({ messageLanguage: "en" });

    const bad = (await patchPerson(req({ action: "language", value: "fr" }, "/api/radar/people/ct1"))) as Response;
    expect(bad.status).toBe(400);
  });

  it("turning the radar off keeps the person and their history", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    const res = (await patchPerson(req({ action: "active", value: false }, "/api/radar/people/ct1"))) as Response;
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).toEqual({ radarInclude: false });
  });
});

/**
 * The pilot gate, finding 3c: a held draft must not inflate the "X ממתין" count this
 * list shows for a contact. The mocked groupBy applies the same pilotHeldAt: null
 * predicate Postgres would, so this catches a route that forgets the where clause
 * entirely, not just one that mis-shapes the payload — same pattern as
 * radar-approvals-route.test.ts.
 */
describe("GET /api/radar/people — pilot gate on the pending count", () => {
  function mockGroupByRespectingPilotFilter(rows: { contactId: string; pilotHeldAt: Date | null }[]) {
    draftGroupBy.mockImplementation(async (args: { where?: { pilotHeldAt?: null } }) => {
      const kept = args?.where && "pilotHeldAt" in args.where ? rows.filter((r) => r.pilotHeldAt === null) : rows;
      const byContact = new Map<string, number>();
      for (const r of kept) byContact.set(r.contactId, (byContact.get(r.contactId) ?? 0) + 1);
      return [...byContact.entries()].map(([contactId, n]) => ({ contactId, _count: { _all: n } }));
    });
  }

  it("does not count a held draft for the owner", async () => {
    contactFindMany.mockResolvedValueOnce([radarContact()]).mockResolvedValueOnce([]);
    mockGroupByRespectingPilotFilter([
      { contactId: "ct1", pilotHeldAt: null },
      { contactId: "ct1", pilotHeldAt: new Date("2026-08-26T06:00:00Z") },
    ]);
    ctx.user.email = "yuval@triolla.io";

    const body = await ((await listPeople(req())) as Response).json();
    expect(body.people[0].pendingDrafts).toBe(1);
  });

  it("counts a held draft for a reviewer", async () => {
    contactFindMany.mockResolvedValueOnce([radarContact()]).mockResolvedValueOnce([]);
    mockGroupByRespectingPilotFilter([
      { contactId: "ct1", pilotHeldAt: null },
      { contactId: "ct1", pilotHeldAt: new Date("2026-08-26T06:00:00Z") },
    ]);
    ctx.user.email = "ariel@triolla.io";

    const body = await ((await listPeople(req())) as Response).json();
    expect(body.people[0].pendingDrafts).toBe(2);
  });

  it("with RADAR_PILOT_HOLD=off the owner sees the held draft counted too", async () => {
    process.env.RADAR_PILOT_HOLD = "off";
    contactFindMany.mockResolvedValueOnce([radarContact()]).mockResolvedValueOnce([]);
    mockGroupByRespectingPilotFilter([
      { contactId: "ct1", pilotHeldAt: null },
      { contactId: "ct1", pilotHeldAt: new Date("2026-08-26T06:00:00Z") },
    ]);
    ctx.user.email = "yuval@triolla.io";

    const body = await ((await listPeople(req())) as Response).json();
    expect(body.people[0].pendingDrafts).toBe(2);
  });

  it("an unheld draft is counted the same for owner and reviewer", async () => {
    for (const email of ["yuval@triolla.io", "ariel@triolla.io"]) {
      contactFindMany.mockResolvedValue([radarContact()]);
      mockGroupByRespectingPilotFilter([{ contactId: "ct1", pilotHeldAt: null }]);
      ctx.user.email = email;
      const body = await ((await listPeople(req())) as Response).json();
      expect(body.people[0].pendingDrafts).toBe(1);
    }
  });
});

/**
 * The pilot gate, finding 3a: the person page's history/`drafts` read-back must not
 * leak a held draft's id/status/title to the owner's browser ahead of the approvals
 * screen.
 */
describe("GET /api/radar/people/[contactId] — pilot gate on draft history", () => {
  function heldDraft() {
    return { id: "dHeld", status: "PENDING_REVIEW", whyHim: null, discardReason: null, createdAt: new Date("2026-08-26T06:00:00Z"), pilotHeldAt: new Date("2026-08-26T06:00:00Z"), item: { title: "held item" } };
  }
  function unheldDraft() {
    return { id: "d1", status: "PENDING_REVIEW", whyHim: null, discardReason: null, createdAt: new Date("2026-08-25T06:00:00Z"), pilotHeldAt: null, item: { title: "unheld item" } };
  }
  function mockRowsRespectingPilotFilter(rows: ReturnType<typeof heldDraft>[]) {
    draftFindMany.mockImplementation(async (args: { where?: { pilotHeldAt?: null } }) => {
      if (args?.where && "pilotHeldAt" in args.where) return rows.filter((r) => r.pilotHeldAt === null);
      return rows;
    });
  }

  it("a held draft is absent from the owner's history", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    mockRowsRespectingPilotFilter([unheldDraft(), heldDraft()]);
    ctx.user.email = "yuval@triolla.io";

    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.history.map((h: { id: string }) => h.id)).toEqual(["d1"]);
  });

  it("a held draft is present in a reviewer's history", async () => {
    contactFindFirst.mockResolvedValue(radarContact());
    mockRowsRespectingPilotFilter([unheldDraft(), heldDraft()]);
    ctx.user.email = "ariel@triolla.io";

    const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
    expect(body.history.map((h: { id: string }) => h.id).sort()).toEqual(["d1", "dHeld"]);
  });

  it("an unheld draft is unaffected in every case", async () => {
    for (const email of ["yuval@triolla.io", "ariel@triolla.io"]) {
      contactFindFirst.mockResolvedValue(radarContact());
      mockRowsRespectingPilotFilter([unheldDraft()]);
      ctx.user.email = email;
      const body = await ((await getPerson(req(undefined, "/api/radar/people/ct1"))) as Response).json();
      expect(body.history).toHaveLength(1);
    }
  });
});
