import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: { effectiveUserId: string }) => unknown) =>
    (req: unknown) =>
      h(req, { effectiveUserId: "owner1" }),
}));

const userFindUniqueOrThrow = vi.fn();
const companyFindMany = vi.fn();
const companyFindUnique = vi.fn();
const companyFindFirst = vi.fn();
const companyCreate = vi.fn();
const companyUpdate = vi.fn();
const companyDelete = vi.fn();
const opportunityFindMany = vi.fn();
const draftFindFirst = vi.fn();
const draftUpdate = vi.fn();
const draftUpdateMany = vi.fn();
const taskCreate = vi.fn();
const send = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUniqueOrThrow: (...a: unknown[]) => userFindUniqueOrThrow(...a) },
    trackedCompany: {
      findMany: (...a: unknown[]) => companyFindMany(...a),
      findUnique: (...a: unknown[]) => companyFindUnique(...a),
      findFirst: (...a: unknown[]) => companyFindFirst(...a),
      create: (...a: unknown[]) => companyCreate(...a),
      update: (...a: unknown[]) => companyUpdate(...a),
      delete: (...a: unknown[]) => companyDelete(...a),
    },
    techOpportunity: { findMany: (...a: unknown[]) => opportunityFindMany(...a) },
    techOpportunityDraft: {
      findFirst: (...a: unknown[]) => draftFindFirst(...a),
      update: (...a: unknown[]) => draftUpdate(...a),
      updateMany: (...a: unknown[]) => draftUpdateMany(...a),
    },
    extensionTask: { create: (...a: unknown[]) => taskCreate(...a) },
  },
}));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));

const { GET: getCompanies, POST: postCompany } = await import("@/app/api/tech-radar/companies/route");
const { PATCH: patchCompany, DELETE: deleteCompany } = await import(
  "@/app/api/tech-radar/companies/[id]/route"
);
const { GET: getFeed } = await import("@/app/api/tech-radar/route");
const { PATCH: patchDraft } = await import("@/app/api/tech-radar/drafts/[draftId]/route");

// The route handlers take a NextRequest; only nextUrl.pathname and json() are used.
function req(body?: unknown, pathname = "/api/tech-radar") {
  return { nextUrl: { pathname }, json: async () => body } as unknown as NextRequest;
}

const usableProfile = {
  businessLines: [{ name: "Retail", description: "d" }],
  products: ["Bit"],
  customerSegments: [],
  techStack: ["Temenos"],
  digitalInitiatives: [],
  focusAreas: [{ area: "fraud", why: "w" }],
  searchQueries: ["fraud detection launch"],
  sources: [{ url: "https://bank.co.il", title: "home" }],
};

beforeEach(() => {
  for (const m of [
    userFindUniqueOrThrow, companyFindMany, companyFindUnique, companyFindFirst,
    companyCreate, companyUpdate, companyDelete, opportunityFindMany,
    draftFindFirst, draftUpdate, draftUpdateMany, taskCreate, send,
  ]) m.mockReset();
  userFindUniqueOrThrow.mockResolvedValue({ orgId: "org1" });
});

describe("GET /api/tech-radar/companies", () => {
  it("scopes the list to the caller's org", async () => {
    companyFindMany.mockResolvedValue([]);
    await getCompanies(req());
    expect(companyFindMany.mock.calls[0][0].where).toEqual({ orgId: "org1" });
  });

  it("returns the profile read-only, including the sources actually read", async () => {
    companyFindMany.mockResolvedValue([
      { id: "c1", name: "בנק הפועלים", website: null, linkedinUrl: null, relationship: "CUSTOMER",
        status: "ACTIVE", profileError: null, researchedAt: new Date(), lastScanAt: null,
        scanIntervalDays: 7, profile: usableProfile, _count: { opportunities: 3 } },
    ]);
    const res = await getCompanies(req());
    const { companies } = await (res as Response).json();
    expect(companies[0].profile.searchQueries).toEqual(["fraud detection launch"]);
    expect(companies[0].profile.sources).toHaveLength(1);
  });

  // A profile that failed research must not masquerade as usable.
  it("nulls an unusable profile rather than surfacing a broken one", async () => {
    companyFindMany.mockResolvedValue([
      { id: "c1", name: "x", website: null, linkedinUrl: null, relationship: "PROSPECT",
        status: "RESEARCH_FAILED", profileError: "no sources", researchedAt: null, lastScanAt: null,
        scanIntervalDays: 7, profile: { focusAreas: [], searchQueries: [] }, _count: { opportunities: 0 } },
    ]);
    const res = await getCompanies(req());
    const { companies } = await (res as Response).json();
    expect(companies[0].profile).toBeNull();
    expect(companies[0].profileError).toBe("no sources");
  });
});

describe("POST /api/tech-radar/companies", () => {
  it("creates the company and fires research", async () => {
    companyFindUnique.mockResolvedValue(null);
    companyCreate.mockResolvedValue({ id: "c1" });
    const res = await postCompany(req({ name: "בנק הפועלים", relationship: "CUSTOMER" }));
    expect((res as Response).status).toBe(200);
    expect(companyCreate.mock.calls[0][0].data).toMatchObject({
      orgId: "org1", name: "בנק הפועלים", relationship: "CUSTOMER", status: "PENDING_RESEARCH",
    });
    expect(send.mock.calls[0][0]).toEqual({
      name: "tech-radar.company.research",
      data: { trackedCompanyId: "c1" },
    });
  });

  it("defaults an unspecified relationship to PROSPECT", async () => {
    companyFindUnique.mockResolvedValue(null);
    companyCreate.mockResolvedValue({ id: "c1" });
    await postCompany(req({ name: "Acme" }));
    expect(companyCreate.mock.calls[0][0].data.relationship).toBe("PROSPECT");
  });

  it("rejects a blank name and an invalid relationship", async () => {
    expect((await postCompany(req({ name: "  " })) as Response).status).toBe(400);
    expect((await postCompany(req({ name: "x", relationship: "FRIEND" })) as Response).status).toBe(400);
    expect(companyCreate).not.toHaveBeenCalled();
  });

  it("409s on a company already tracked by this org", async () => {
    companyFindUnique.mockResolvedValue({ id: "existing" });
    const res = await postCompany(req({ name: "בנק הפועלים" }));
    expect((res as Response).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/tech-radar/companies/[id]", () => {
  it("re-researches, clearing the previous error", async () => {
    companyFindFirst.mockResolvedValue({ id: "c1" });
    const res = await patchCompany(req({ action: "research" }, "/api/tech-radar/companies/c1"));
    expect((res as Response).status).toBe(200);
    expect(companyUpdate.mock.calls[0][0].data).toEqual({ status: "PENDING_RESEARCH", profileError: null });
    expect(send).toHaveBeenCalled();
  });

  it("toggles the relationship and validates it", async () => {
    companyFindFirst.mockResolvedValue({ id: "c1" });
    await patchCompany(req({ action: "relationship", relationship: "CUSTOMER" }, "/api/tech-radar/companies/c1"));
    expect(companyUpdate.mock.calls[0][0].data).toEqual({ relationship: "CUSTOMER" });
    const bad = await patchCompany(req({ action: "relationship", relationship: "X" }, "/api/tech-radar/companies/c1"));
    expect((bad as Response).status).toBe(400);
  });

  it("validates the scan interval", async () => {
    companyFindFirst.mockResolvedValue({ id: "c1" });
    await patchCompany(req({ action: "interval", scanIntervalDays: 14 }, "/api/tech-radar/companies/c1"));
    expect(companyUpdate.mock.calls[0][0].data).toEqual({ scanIntervalDays: 14 });
    for (const bad of [0, -1, 91, 1.5, "x"]) {
      const res = await patchCompany(req({ action: "interval", scanIntervalDays: bad }, "/api/tech-radar/companies/c1"));
      expect((res as Response).status).toBe(400);
    }
  });

  // Tenancy: another org's company must be invisible, not merely unauthorised.
  it("404s on a company outside the caller's org", async () => {
    companyFindFirst.mockResolvedValue(null);
    const res = await patchCompany(req({ action: "research" }, "/api/tech-radar/companies/other"));
    expect((res as Response).status).toBe(404);
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it("deletes only within the caller's org", async () => {
    companyFindFirst.mockResolvedValue(null);
    expect((await deleteCompany(req(undefined, "/api/tech-radar/companies/other")) as Response).status).toBe(404);
    companyFindFirst.mockResolvedValue({ id: "c1" });
    expect((await deleteCompany(req(undefined, "/api/tech-radar/companies/c1")) as Response).status).toBe(200);
    expect(companyDelete).toHaveBeenCalled();
  });
});

describe("GET /api/tech-radar", () => {
  it("scopes opportunities to the org and drafts to the caller", async () => {
    opportunityFindMany.mockResolvedValue([]);
    await getFeed(req());
    const args = opportunityFindMany.mock.calls[0][0];
    expect(args.where.trackedCompany).toEqual({ orgId: "org1" });
    expect(args.select.drafts.where.ownerId).toBe("owner1");
  });

  // "no one to contact" is information, so an opportunity with no drafts must survive.
  it("keeps an opportunity that has no drafts", async () => {
    opportunityFindMany.mockResolvedValue([
      { id: "o1", fitRationale: "מתחבר לביט", score: 0.8, status: "DISCOVERED", createdAt: new Date(),
        trackedCompany: { id: "c1", name: "בנק הפועלים", relationship: "CUSTOMER" },
        item: { id: "i1", vendor: "Acme", technology: "Shield", title: "t", summary: "s",
                categories: ["fraud"], sources: [], publishedAt: null, thin: false },
        drafts: [] },
    ]);
    const res = await getFeed(req());
    const { opportunities } = await (res as Response).json();
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].drafts).toEqual([]);
  });
});

describe("PATCH /api/tech-radar/drafts/[draftId]", () => {
  const path = "/api/tech-radar/drafts/d1";

  it("404s on a draft owned by someone else", async () => {
    draftFindFirst.mockResolvedValue(null);
    expect((await patchDraft(req({ action: "dismiss" }, path)) as Response).status).toBe(404);
  });

  it("only ever looks up drafts owned by the caller", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "Y", linkedinUrl: null } });
    await patchDraft(req({ action: "dismiss" }, path));
    expect(draftFindFirst.mock.calls[0][0].where).toEqual({ id: "d1", ownerId: "owner1" });
  });

  it("queues a PREPARE_MESSAGE task linked back to the draft", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "דנה", linkedinUrl: "https://li/d" } });
    draftUpdateMany.mockResolvedValue({ count: 1 });
    const res = await patchDraft(req({ action: "prepare", message: "היי דנה" }, path));
    expect((res as Response).status).toBe(200);
    expect(draftUpdateMany.mock.calls[0][0].where).toEqual({ id: "d1", status: "PENDING_REVIEW" });
    expect(taskCreate.mock.calls[0][0].data).toMatchObject({
      userId: "owner1", kind: "PREPARE_MESSAGE", techDraftId: "d1",
    });
  });

  // The guard that stops a double-click queueing two prepare tasks.
  it("409s and queues nothing when the draft is no longer pending", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "דנה", linkedinUrl: "https://li/d" } });
    draftUpdateMany.mockResolvedValue({ count: 0 });
    const res = await patchDraft(req({ action: "prepare", message: "היי" }, path));
    expect((res as Response).status).toBe(409);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("refuses to prepare a LinkedIn message with no profile url", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "דנה", linkedinUrl: null } });
    const res = await patchDraft(req({ action: "prepare", message: "היי" }, path));
    expect((res as Response).status).toBe(400);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("records PREPARED for email and whatsapp, and rejects other channels", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "דנה", linkedinUrl: null } });
    draftUpdateMany.mockResolvedValue({ count: 1 });
    await patchDraft(req({ action: "prepared", channel: "email", message: "היי" }, path));
    expect(draftUpdateMany.mock.calls[0][0].data).toMatchObject({ status: "PREPARED", channel: "EMAIL" });
    const bad = await patchDraft(req({ action: "prepared", channel: "linkedin", message: "היי" }, path));
    expect((bad as Response).status).toBe(400);
  });

  it("stamps sentAt on the user's own send confirmation", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "דנה", linkedinUrl: null } });
    await patchDraft(req({ action: "sent", channel: "whatsapp" }, path));
    expect(draftUpdate.mock.calls[0][0].data).toMatchObject({ status: "SENT", channel: "WHATSAPP" });
    expect(draftUpdate.mock.calls[0][0].data.sentAt).toBeInstanceOf(Date);
  });

  it("keeps the stored channel on a bare sent confirmation", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "דנה", linkedinUrl: null } });
    await patchDraft(req({ action: "sent" }, path));
    expect(draftUpdate.mock.calls[0][0].data.channel).toBeUndefined();
  });

  it("rejects an empty saved message and an unknown action", async () => {
    draftFindFirst.mockResolvedValue({ id: "d1", contact: { fullName: "דנה", linkedinUrl: null } });
    expect((await patchDraft(req({ action: "save", message: "   " }, path)) as Response).status).toBe(400);
    expect((await patchDraft(req({ action: "nope" }, path)) as Response).status).toBe(400);
  });
});
