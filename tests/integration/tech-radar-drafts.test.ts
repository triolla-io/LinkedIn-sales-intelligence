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

const suggestContactRole = vi.fn();
vi.mock("@/lib/tech-radar/suggest-contact", () => ({
  suggestContactRole: (...a: unknown[]) => suggestContactRole(...a),
}));

const rankRecipients = vi.fn();
vi.mock("@/lib/tech-radar/recipients", async () => {
  const actual = await import("@/lib/tech-radar/recipients");
  return { ...actual, rankRecipients: (...a: unknown[]) => rankRecipients(...a) };
});
const draftTechMessage = vi.fn();
vi.mock("@/lib/tech-radar/draft", () => ({ draftTechMessage: (...a: unknown[]) => draftTechMessage(...a) }));

const { createDraftsForOpportunity } = await import("@/lib/tech-radar/create-drafts");

function opportunity() {
  return {
    id: "o1",
    fitRationale: "מתחבר לביט ולתשלומים בין-אישיים",
    item: { technology: "Shield", title: "Acme launches Shield", summary: "generic product blurb", vendor: "Acme" },
    trackedCompany: {
      id: "c1", orgId: "org1", name: "בנק הפועלים", companyId: "co1", aliases: [],
      // A usable profile is required before a contact recommendation can be asked for.
      profile: {
        businessLines: [{ name: "Retail payments", description: "cards" }],
        products: ["Bit"], customerSegments: [], techStack: [], digitalInitiatives: [],
        focusAreas: [{ area: "fraud", why: "w" }],
        searchQueries: ["fraud detection launch"], sources: [],
      },
    },
  };
}
function contact(id: string, currentTitle = "VP Payments") {
  return { id, fullName: `Person ${id}`, hebrewFirstName: "דנה", currentTitle, headline: null };
}

beforeEach(() => {
  for (const m of [
    opportunityFindUniqueOrThrow, opportunityUpdate, userFindMany,
    contactFindMany, draftFindUnique, draftCreate, draftCount, rankRecipients, draftTechMessage,
    suggestContactRole,
  ]) m.mockReset();
  draftCount.mockResolvedValue(0);
  suggestContactRole.mockResolvedValue(null);
  opportunityFindUniqueOrThrow.mockResolvedValue(opportunity());
  draftFindUnique.mockResolvedValue(null);
  draftCreate.mockResolvedValue({ id: "d1" });
  draftTechMessage.mockResolvedValue("היי דנה, נתקלתי במשהו חדש");
});

describe("createDraftsForOpportunity", () => {
  it("creates one draft per ranked recipient and marks the opportunity DRAFTED", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([
      { ...contact("a"), ownerId: "owner1" },
      { ...contact("b"), ownerId: "owner1" },
    ]);
    rankRecipients.mockResolvedValue([
      { contactId: "a", score: 0.9, reason: "r" },
      { contactId: "b", score: 0.7, reason: "r" },
    ]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(2);
    // Drafting also clears any stale reason from a previous run.
    expect(opportunityUpdate.mock.calls[0][0].data).toEqual({ status: "DRAFTED", blockReason: null });
  });

  // The cap is per (opportunity x owner) because the owner is who sends.
  it("gives each owner in the org their own recipients", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }, { id: "owner2" }]);
    contactFindMany.mockResolvedValue([
      { ...contact("a"), ownerId: "owner1" },
      { ...contact("b"), ownerId: "owner2" },
    ]);
    rankRecipients.mockImplementation(async (_i: unknown, cands: { contactId: string }[]) => [
      { contactId: cands[0].contactId, score: 0.9, reason: "r" },
    ]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.owners).toBe(2);
    expect(out.created).toBe(2);
    expect(draftCreate.mock.calls.map((c) => c[0].data.ownerId).sort()).toEqual(["owner1", "owner2"]);
  });

  it("scopes the contact query to the org's owners and the company", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.ownerId).toEqual({ in: ["owner1"] });
    expect(where.companyId).toBe("co1");
    expect(where.removedAt).toBeNull();
  });

  /**
   * The live run logged "1 drafts across 2591 owners": the loop asked the database for
   * contacts once per user in the org, for every opportunity. Almost all of those
   * owners have nobody at the company, so the work is pure waste and it grows with
   * headcount. One query now covers the whole org and is grouped in memory.
   */
  it("asks the database for contacts once, not once per owner", async () => {
    userFindMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({ id: `owner${i}` }))
    );
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner7" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);

    const out = await createDraftsForOpportunity("o1");
    expect(contactFindMany).toHaveBeenCalledTimes(1);
    // Only the one owner who actually has somebody there is ranked.
    expect(rankRecipients).toHaveBeenCalledTimes(1);
    expect(out.created).toBe(1);
    expect(draftCreate.mock.calls[0][0].data.ownerId).toBe("owner7");
  });

  // "No one to contact" is a legitimate outcome, but a dead end on its own.
  it("creates nothing and stays DISCOVERED when the owner has no senior contact there", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(rankRecipients).not.toHaveBeenCalled();
  });

  function suggestionWritten() {
    const call = opportunityUpdate.mock.calls.find((c) => "contactSuggestion" in c[0].data);
    return call?.[0].data.contactSuggestion as string | undefined;
  }

  it("records which role to go after when there is nobody senior at the company", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([]);
    suggestContactRole.mockResolvedValue('שווה להגיע לסמנכ״ל התשלומים');
    const out = await createDraftsForOpportunity("o1");
    expect(suggestionWritten()).toBe('שווה להגיע לסמנכ״ל התשלומים');
    expect(out.blockedBy).toBe("no_senior_contact");
  });

  /**
   * The first human-run scan left four opportunities with no drafts and no
   * recommendation, because the recommendation only fired when the company had zero
   * senior contacts. In every one of those four the company HAD contacts — the ranker
   * found none of them a role match, which is exactly when knowing the missing role is
   * worth most. The screen also claimed "you have no senior contact here", which was
   * simply false.
   */
  it("recommends a role when contacts exist but none matches the technology", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([]); // ranker rejected everyone
    suggestContactRole.mockResolvedValue('צריך מישהו שמחזיק את הפרשנות התת-קרקעית');
    const out = await createDraftsForOpportunity("o1");
    expect(suggestionWritten()).toBe('צריך מישהו שמחזיק את הפרשנות התת-קרקעית');
    expect(out.blockedBy).toBe("no_role_match");
  });

  it("reports the cap, without a recommendation, when everyone is simply full", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    draftCount.mockResolvedValue(2); // already at the per-contact cap
    const out = await createDraftsForOpportunity("o1");
    expect(out.blockedBy).toBe("contacts_at_capacity");
    // Their contacts are right, they are just saturated — recommending a role would be wrong.
    expect(suggestContactRole).not.toHaveBeenCalled();
  });

  it("does not ask for a recommendation when drafts were actually created", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(1);
    expect(out.blockedBy).toBeNull();
    expect(suggestContactRole).not.toHaveBeenCalled();
  });

  it("survives the recommendation failing", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([]);
    suggestContactRole.mockResolvedValue(null);
    await expect(createDraftsForOpportunity("o1")).resolves.toMatchObject({ created: 0 });
  });

  it("creates nothing when ranking rejects everyone", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(draftCreate).not.toHaveBeenCalled();
  });

  // Idempotence: an Inngest retry must not double-draft.
  it("skips a contact that already has a draft for this opportunity", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    draftFindUnique.mockResolvedValue({ id: "existing" });
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(draftCreate).not.toHaveBeenCalled();
  });

  it("drops a ranked id that is not in the candidate set", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "ghost", score: 1, reason: "r" }]);
    expect((await createDraftsForOpportunity("o1")).created).toBe(0);
  });

  // The whole point: the message is built from the rationale, not the generic blurb.
  it("passes the fitRationale into the draft, not the item summary", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    const arg = draftTechMessage.mock.calls[0][0];
    expect(arg.fitRationale).toBe("מתחבר לביט ולתשלומים בין-אישיים");
    expect(JSON.stringify(arg)).not.toContain("generic product blurb");
  });

  // One register for every company: the distinction was removed from the model entirely.
  it("does not send any relationship to the drafter", async () => {
    opportunityFindUniqueOrThrow.mockResolvedValue(opportunity());
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    expect(draftTechMessage.mock.calls[0][0]).not.toHaveProperty("relationship");
    expect(draftTechMessage.mock.calls[0][0].hebrewFirstName).toBe("דנה");
  });

  /**
   * From the live Delek Group run: the CEO received FIVE messages from a single scan,
   * because the 3-per-opportunity cap says nothing about how many opportunities one
   * person may receive. A contact already holding open drafts is skipped.
   */
  it("skips a contact who already has enough open drafts", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    draftCount.mockResolvedValue(2);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(draftTechMessage).not.toHaveBeenCalled();
  });

  it("counts only that contact's recent, still-open drafts", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
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
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    draftCount.mockResolvedValue(1);
    expect((await createDraftsForOpportunity("o1")).created).toBe(1);
  });

  /**
   * The SQL prefilter uses `contains`, which cannot express a word boundary, so "coo"
   * matched every "Coordinator". A Human Resources Coordinator was drafted a message in
   * the live run; the precise check has to run after the query.
   */
  it("drops a contact the coarse SQL filter let through but who is not senior", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([
      { ...contact("hr", "Human Resources Coordinator"), ownerId: "owner1" },
      { ...contact("vp", "VP Payments"), ownerId: "owner1" },
    ]);
    rankRecipients.mockImplementation(async (_i: unknown, cands: { contactId: string }[]) =>
      cands.map((c) => ({ contactId: c.contactId, score: 0.9, reason: "r" }))
    );

    await createDraftsForOpportunity("o1");
    // The coordinator must never even be offered to the ranker.
    const offered = (rankRecipients.mock.calls[0][1] as { contactId: string }[]).map((c) => c.contactId);
    expect(offered).toEqual(["vp"]);
    expect(draftCreate.mock.calls.map((c) => c[0].data.contactId)).toEqual(["vp"]);
  });

  it("creates nothing when every prefiltered contact turns out to be junior", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([
      { ...contact("hr", "Recruiting Coordinator"), ownerId: "owner1" },
    ]);
    const out = await createDraftsForOpportunity("o1");
    expect(out.created).toBe(0);
    expect(rankRecipients).not.toHaveBeenCalled();
  });

  it("creates drafts in PENDING_REVIEW — the system prepares, the human sends", async () => {
    userFindMany.mockResolvedValue([{ id: "owner1" }]);
    contactFindMany.mockResolvedValue([{ ...contact("a"), ownerId: "owner1" }]);
    rankRecipients.mockResolvedValue([{ contactId: "a", score: 0.9, reason: "r" }]);
    await createDraftsForOpportunity("o1");
    expect(draftCreate.mock.calls[0][0].data.status).toBe("PENDING_REVIEW");
  });
});
