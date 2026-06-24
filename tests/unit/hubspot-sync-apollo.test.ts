import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertContact = vi.fn();
const findMany = vi.fn();
const update = vi.fn();

vi.mock("@/lib/hubspot/client", () => ({ upsertContact: (...a: unknown[]) => upsertContact(...a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { contact: { findMany: (...a: unknown[]) => findMany(...a), update: (...a: unknown[]) => update(...a) } },
}));

async function runHandler() {
  const { hubspotSyncApollo } = await import("@/inngest/functions/hubspot-sync-apollo");
  // Inngest exposes the handler as .fn (confirmed in InngestFunction.cjs: `this.fn = fn`)
  return (hubspotSyncApollo as unknown as { fn: (arg: unknown) => Promise<unknown> }).fn({ step: {} });
}

describe("hubspotSyncApollo", () => {
  beforeEach(() => {
    vi.resetModules();
    upsertContact.mockReset();
    findMany.mockReset();
    update.mockReset();
  });

  it("upserts each apollo-sourced contact and stamps hubspotSyncedAt on success", async () => {
    findMany.mockResolvedValue([
      { id: "c1", linkedinUrl: "u1", email: "a@x.com", phone: "+972521111111", currentCompany: "Acme", industry: "Tech", companySize: 10, enrichedAt: new Date("2024-01-02"), hubspotSyncedAt: new Date("2024-01-01") },
    ]);
    upsertContact.mockResolvedValue({ ok: true, hubspotId: "h1" });

    const res = await runHandler();

    expect(upsertContact).toHaveBeenCalledWith({
      linkedinUrl: "u1",
      email: "a@x.com",
      mobilePhone: "+972521111111",
      company: "Acme",
      industry: "Tech",
      companySize: 10,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: expect.objectContaining({ hubspotSyncedAt: expect.any(Date) }) })
    );
    expect(res).toEqual({ synced: 1, failed: 0 });
  });

  it("does not stamp hubspotSyncedAt when upsert fails", async () => {
    findMany.mockResolvedValue([{ id: "c2", linkedinUrl: "u2", email: "b@x.com", phone: null, currentCompany: null, industry: null, companySize: null, enrichedAt: new Date(), hubspotSyncedAt: null }]);
    upsertContact.mockResolvedValue({ ok: false });

    const res = await runHandler();

    expect(update).not.toHaveBeenCalled();
    expect(res).toEqual({ synced: 0, failed: 1 });
  });
});
