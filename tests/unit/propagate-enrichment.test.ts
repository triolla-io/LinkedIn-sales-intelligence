import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { contact: { findMany: mockFindMany, update: mockUpdate } },
}));

async function run(opts: {
  orgId: string;
  linkedinUrlNormalized: string;
  sourceContactId?: string;
  values: Record<string, unknown>;
}) {
  const { propagateEnrichment } = await import("@/lib/enrichment/propagate");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return propagateEnrichment(opts as any);
}

const NORM = "https://www.linkedin.com/in/dana-cohen";

describe("propagateEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
  });

  it("fills only empty fields on a matching sibling and marks it enriched", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "sibling",
        linkedinUrl: "https://www.linkedin.com/in/dana-cohen/",
        email: null,
        phone: "+972500000000", // already set — must NOT be overwritten
        companySize: null,
        currentCompany: null,
        industry: null,
      },
    ]);

    const res = await run({
      orgId: "org1",
      linkedinUrlNormalized: NORM,
      sourceContactId: "source",
      values: { email: "dana@acme.com", phone: "+972999999999", companySize: 200 },
    });

    expect(res).toEqual({ scanned: 1, filled: 1 });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.email).toBe("dana@acme.com");
    expect(data.companySize).toBe(200);
    expect(data).not.toHaveProperty("phone"); // existing phone preserved
    expect(data.enrichmentSource).toBe("cache");
    expect(data.enrichedAt).toBeInstanceOf(Date);
  });

  it("skips false-positive substring matches whose normalized URL differs", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "other",
        linkedinUrl: "https://www.linkedin.com/in/dana-cohen-2",
        email: null,
        phone: null,
        companySize: null,
        currentCompany: null,
        industry: null,
      },
    ]);

    const res = await run({
      orgId: "org1",
      linkedinUrlNormalized: NORM,
      values: { email: "dana@acme.com" },
    });

    expect(res).toEqual({ scanned: 1, filled: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not update a sibling that is already fully populated", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "full",
        linkedinUrl: "https://www.linkedin.com/in/dana-cohen",
        email: "already@acme.com",
        phone: "+972500000000",
        companySize: 10,
        currentCompany: "Acme",
        industry: "Tech",
      },
    ]);

    const res = await run({
      orgId: "org1",
      linkedinUrlNormalized: NORM,
      values: { email: "dana@acme.com", phone: "+972999999999" },
    });

    expect(res).toEqual({ scanned: 1, filled: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns early with no query when the normalized URL has no slug", async () => {
    const res = await run({ orgId: "org1", linkedinUrlNormalized: "", values: { email: "x@y.com" } });
    expect(res).toEqual({ scanned: 0, filled: 0 });
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
