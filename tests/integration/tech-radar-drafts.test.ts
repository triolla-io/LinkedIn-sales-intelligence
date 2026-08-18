import { describe, it, expect, vi, beforeEach } from "vitest";

const opportunityFindUniqueOrThrow = vi.fn();
const opportunityUpdate = vi.fn();
const userFindMany = vi.fn();
const contactFindMany = vi.fn();
const draftFindUnique = vi.fn();
const draftCreate = vi.fn();
const draftCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    techOpportunity: {
      findUniqueOrThrow: (...a: unknown[]) => opportunityFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => opportunityUpdate(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    techOpportunityDraft: {
      findUnique: (...a: unknown[]) => draftFindUnique(...a),
      create: (...a: unknown[]) => draftCreate(...a),
      count: (...a: unknown[]) => draftCount(...a),
    },
  },
}));

const rankRecipients = vi.fn();
vi.mock("@/lib/tech-radar/recipients", async () => {
  const actual = await import("@/lib/tech-radar/recipients");
  return { ...actual, rankRecipients: (...a: unknown[]) => rankRecipients(...a) };
});
const draftTechMessage = vi.fn();
vi.mock("@/lib/tech-radar/draft", () => ({ draftTechMessage: (...a: unknown[]) => draftTechMessage(...a) }));

const { createDraftsForOpportunity } = await import("@/lib/tech-radar/create-drafts");

function opportunity(relationship: "CUSTOMER" | "PROSPECT" = "PROSPECT") {
  return {
    id: "o1",
    fitRationale: "מתחבר לביט ולתשלומים בין-אישיים",
    item: { technology: "Shield", title: "Acme launches Shield", summary: "generic product blurb", vendor: "Acme" },
    trackedCompany: { id: "c1", orgId: "org1", name: "בנק הפועלים", companyId: "co1", relationship },
  };
}
function contact(id: string) {
  return { id, fullName: `Person ${id}`, hebrewFirstName: "דנה", currentTitle: "VP Payments", headline: null };
}

beforeEach(() => {
  for (const m of [
    opportunityFindUniqueOrThrow, opportunityUpdate, userFindMany,
    contactFindMany, draftFindUnique, draftCreate, draftCount, rankRecipients, draftTechMessage,
  ]) m.mockReset();
  draftCount.mockResolvedValue(0);
  opportunityFindUniqueOrThrow.mockResolvedValue(opportunity());
  draftFindUnique.mockResolvedValue(null);
  draftCreate.mockResolvedValue({ id: "d1" });
  draftTechMessage.mockResolvedValue("היי דנה, נתקלתי במשהו חדש");
});

describe("createDraftsForOpportunity", () => {
  it("creates one draft per ranked recipient and marks the opportunity DRAFTED", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a"), contact("b")]);
    rankRecipients.mockResolvedValue([
      { contactId: "a", score: 0.9, reason: "r" },
      { contactId: "b", score: 0.7, reason: "r" },
    ]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(2);
    expect(opportunityUpdate.mock.calls[0][0].data).toEqual({ status: "DRAFTED" });
  });

  // The cap is per (opportunity x owner) because the owner is who sends.
  it("gives each owner in the org their own recipients", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }, { id: "owner2" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.owners).toBe(2);
    expect(out.created).toBe(2);
    expect(draftCreate.mock.calls.map((c) => c[0].data.ownerId)).toEqual(["owner1", "owner2"]);
  });

  it("scopes the contact query to the owner and the company", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe("owner1");
    expect(where.companyId).toBe("co1");
    expect(where.removedAt).toBeNull();
  });

  // "No one to contact" is a legitimate, informative outcome.
  it("creates nothing and stays DISCOVERED when the owner has no senior contact there", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(rankRecipients).not.toHaveBeenCalled();
    expect(opportunityUpdate).not.toHaveBeenCalled();
  });

  it("creates nothing when ranking rejects everyone", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(draftCreate).not.toHaveBeenCalled();
  });

  // Idempotence: an Inngest retry must not double-draft.
  it("skips a contact that already has a draft for this opportunity", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    draftFindUnique.mockResolvedValue({ id: "existing" });
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(draftCreate).not.toHaveBeenCalled();
  });

  it("drops a ranked id that is not in the candidate set", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "ghost", score: 1, reason: "r" }]);
    expect((await createDraftsForOpportunity("o1")).created).toBe(0);
  });

  // The whole point: the message is built from the rationale, not the generic blurb.
  it("passes the fitRationale into the draft, not the item summary", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    const arg = draftTechMessage.mock.calls[0][0];
    expect(arg.fitRationale).toBe("מתחבר לביט ולתשלומים בין-אישיים");
    expect(JSON.stringify(arg)).not.toContain("generic product blurb");
  });

  it("passes the company relationship through so the tone is right", async () => {
    opportunityFindUniqueOrThrow.mockResolvedValue(opportunity("CUSTOMER"));
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    expect(draftTechMessage.mock.calls[0][0].relationship).toBe("CUSTOMER");
    expect(draftTechMessage.mock.calls[0][0].hebrewFirstName).toBe("דנה");
  });

  /**
   * From the live Delek Group run: the CEO received FIVE messages from a single scan,
   * because the 3-per-opportunity cap says nothing about how many opportunities one
   * person may receive. A contact already holding open drafts is skipped.
   */
  it("skips a contact who already has enough open drafts", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    draftCount.mockResolvedValue(2);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(draftTechMessage).not.toHaveBeenCalled();
  });

  it("counts only that contact's recent, still-open drafts", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    const where = draftCount.mock.calls[0][0].where;
    expect(where.contactId).toBe("a");
    expect(where.status.in).toEqual(expect.arrayContaining(["PENDING_REVIEW"]));
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    // A dismissed draft must not count against the person.
    expect(where.status.in).not.toContain("DISMISSED");
  });

  it("still drafts for a contact under the limit", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    draftCount.mockResolvedValue(1);
    expect((await createDraftsForOpportunity("o1")).created).toBe(1);
  });

  it("creates drafts in PENDING_REVIEW — the system prepares, the human sends", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([contact("a")]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    expect(draftCreate.mock.calls[0][0].data.status).toBe("PENDING_REVIEW");
  });
});
