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
  checkBudget: (...a: unknown[]) => mockCheckBudget(...a),
  incrementBudget: (...a: unknown[]) => mockIncrementBudget(...a),
}));

const mockLookupContact = vi.fn();
vi.mock("@/lib/hubspot/client", () => ({ lookupContact: (...a: unknown[]) => mockLookupContact(...a) }));

const contact = {
  id: "c1",
  fullName: "Dana Cohen",
  linkedinUrl: "https://www.linkedin.com/in/dana-cohen/",
  currentCompany: null,
  industry: null,
  manualFields: [],
};

async function run() {
  const { enrichContactCore } = await import("@/lib/enrichment/enrich-contact-core");
  return enrichContactCore({ contact, orgId: "org1", monthlyApolloBudget: 100 });
}

describe("enrichContactCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckBudget.mockResolvedValue({ allowed: true, creditsRemaining: 50 });
    mockLookupContact.mockResolvedValue(null);
    mockPersonFindUnique.mockResolvedValue(null);
    mockTransaction.mockResolvedValue([]);
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

  it("returns budget_exhausted without touching HubSpot or Apollo", async () => {
    mockCheckBudget.mockResolvedValue({ allowed: false, creditsRemaining: 0 });

    const result = await run();

    expect(result).toEqual({ status: "budget_exhausted" });
    expect(mockLookupContact).not.toHaveBeenCalled();
    expect(mockMatchPerson).not.toHaveBeenCalled();
  });

  it("persists enrichmentError and reports apollo_error when Apollo throws", async () => {
    mockMatchPerson.mockRejectedValue(new Error("429: rate limited"));

    const result = await run();

    expect(result).toEqual({ status: "apollo_error", error: "429: rate limited" });
    expect(mockContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentError: "429: rate limited" }) })
    );
  });
});
