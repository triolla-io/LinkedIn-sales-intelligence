import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockContactUpdate = vi.fn();
const mockPersonFindUnique = vi.fn();
const mockPersonUpsert = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { update: mockContactUpdate },
    personEnrichment: { findUnique: mockPersonFindUnique, upsert: mockPersonUpsert },
    $transaction: mockTransaction,
  },
}));

// Prisma.JsonNull / Prisma.InputJsonValue are referenced by the core.
vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: { JsonNull: null } }));

const mockMatchPerson = vi.fn();
vi.mock("@/lib/apollo/client", () => ({ matchPerson: (...a: unknown[]) => mockMatchPerson(...a) }));

const mockCheckBudget = vi.fn();
const mockIncrementBudget = vi.fn();
vi.mock("@/lib/apollo/budget", () => ({
  checkEnrichmentBudget: (...a: unknown[]) => mockCheckBudget(...a),
  incrementBudget: (...a: unknown[]) => mockIncrementBudget(...a),
  // Pure cost helper — use the real formula so the test reflects real billing.
  enrichmentCreditCost: (r: { email?: string | null; phone?: string | null }) =>
    Math.max(1, (r.email ? 1 : 0) + (r.phone ? 8 : 0)),
}));

const mockLookupContact = vi.fn();
vi.mock("@/lib/hubspot/client", () => ({ lookupContact: (...a: unknown[]) => mockLookupContact(...a) }));

const mockInngestSend = vi.fn();
vi.mock("@/inngest/client", () => ({
  inngest: { send: (...a: unknown[]) => mockInngestSend(...a) },
}));

const contact = {
  id: "c1",
  fullName: "Dana Cohen",
  linkedinUrl: "https://www.linkedin.com/in/dana-cohen/",
  currentCompany: null,
  industry: null,
  manualFields: [],
};

const budgetOpts = {
  orgId: "org1",
  ownerId: "u1",
  monthlyApolloBudget: 2000,
  perUserMonthlyApolloCredits: 1000,
};

async function run() {
  const { enrichContactCore } = await import("@/lib/enrichment/enrich-contact-core");
  return enrichContactCore({ contact, ...budgetOpts });
}

describe("enrichContactCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckBudget.mockResolvedValue({ allowed: true, blockedBy: null, creditsRemaining: 50 });
    mockLookupContact.mockResolvedValue(null);
    mockPersonFindUnique.mockResolvedValue(null);
    mockTransaction.mockResolvedValue([]);
    mockInngestSend.mockResolvedValue(undefined);
  });

  it("stops at the cache and never calls Apollo when a cached hit exists", async () => {
    mockPersonFindUnique.mockResolvedValue({ email: "dana@acme.com", phone: null, companySize: 200, enrichedByContactId: "other" });

    const result = await run();

    expect(result).toMatchObject({ status: "ok", source: "cache", email: "dana@acme.com", companySize: 200 });
    expect(mockMatchPerson).not.toHaveBeenCalled();
    expect(mockIncrementBudget).not.toHaveBeenCalled();
  });

  it("writes Apollo results back into the PersonEnrichment cache and charges a credit", async () => {
    mockMatchPerson.mockResolvedValue({ email: "dana@acme.com", phone: "+972500000000", companySize: 10, raw: { x: 1 } });

    const result = await run();

    expect(result).toMatchObject({ status: "ok", source: "apollo", email: "dana@acme.com" });
    expect(mockPersonUpsert).toHaveBeenCalledTimes(1); // cache primed
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockIncrementBudget).toHaveBeenCalledTimes(1);
  });

  it("returns budget_exhausted without touching HubSpot or Apollo when the org pool is gone", async () => {
    mockCheckBudget.mockResolvedValue({ allowed: false, blockedBy: "org", creditsRemaining: 0 });

    const result = await run();

    expect(result).toEqual({ status: "budget_exhausted", blockedBy: "org" });
    expect(mockLookupContact).not.toHaveBeenCalled();
    expect(mockMatchPerson).not.toHaveBeenCalled();
  });

  it("returns budget_exhausted when the OWNER is out of quota even if the org pool has room", async () => {
    mockCheckBudget.mockResolvedValue({ allowed: false, blockedBy: "user", creditsRemaining: 0 });

    const result = await run();

    expect(result).toEqual({ status: "budget_exhausted", blockedBy: "user" });
    expect(mockMatchPerson).not.toHaveBeenCalled();
  });

  it("charges the contact owner, not the acting admin, and bills the real 9-credit cost", async () => {
    mockMatchPerson.mockResolvedValue({ email: "dana@acme.com", phone: "+972500000000", raw: {} });

    await run();

    expect(mockIncrementBudget).toHaveBeenCalledWith({
      orgId: "org1",
      userId: "u1",
      credits: 9, // email (1) + revealed mobile (8)
    });
  });

  it("checks the per-user quota alongside the org pool before spending", async () => {
    await run();

    expect(mockCheckBudget).toHaveBeenCalledWith({
      orgId: "org1",
      userId: "u1",
      orgLimit: 2000,
      userLimit: 1000,
    });
  });

  it("persists enrichmentError and reports apollo_error when Apollo throws", async () => {
    mockMatchPerson.mockRejectedValue(new Error("429: rate limited"));

    const result = await run();

    expect(result).toEqual({ status: "apollo_error", error: "429: rate limited" });
    expect(mockContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentError: "429: rate limited" }) })
    );
  });

  it("applies HubSpot phone when present and not manually protected", async () => {
    mockLookupContact.mockResolvedValue({ email: "a@b.com", phone: "+972521234567" });

    const result = await run();

    expect(result).toMatchObject({ status: "ok", source: "hubspot", phone: "+972521234567" });
    expect(mockContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "+972521234567" }) })
    );
  });

  it("does NOT write HubSpot phone to the contact when phone is in manualFields (protected)", async () => {
    const { enrichContactCore } = await import("@/lib/enrichment/enrich-contact-core");
    const protectedContact = { ...contact, manualFields: ["phone"] };
    mockLookupContact.mockResolvedValue({ email: "a@b.com", phone: "+972521234567" });

    const result = await enrichContactCore({ contact: protectedContact, ...budgetOpts });

    expect(result).toMatchObject({ status: "ok", source: "hubspot" });
    expect(mockContactUpdate).toHaveBeenCalledTimes(1);
    const updateData = mockContactUpdate.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("phone");
    expect(updateData).toHaveProperty("email", "a@b.com");
  });

  it("emits enrichment.propagate with the enriched values after an Apollo hit", async () => {
    mockMatchPerson.mockResolvedValue({
      email: "dana@acme.com",
      phone: "+972500000000",
      companySize: 10,
      currentCompany: "Acme",
      industry: "Tech",
      raw: { x: 1 },
    });

    await run();

    expect(mockInngestSend).toHaveBeenCalledTimes(1);
    const evt = mockInngestSend.mock.calls[0][0];
    expect(evt.name).toBe("enrichment.propagate");
    expect(evt.data).toMatchObject({
      orgId: "org1",
      linkedinUrlNormalized: "https://www.linkedin.com/in/dana-cohen",
      sourceContactId: "c1",
      values: { email: "dana@acme.com", phone: "+972500000000", companySize: 10 },
    });
  });
});
