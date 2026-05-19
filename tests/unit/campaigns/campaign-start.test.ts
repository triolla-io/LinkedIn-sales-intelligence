import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  sendMock,
  mockCampaignFindUnique,
  mockContactFindMany,
  mockRecipientCreate,
  mockCampaignUpdate,
} = vi.hoisted(() => ({
  sendMock: vi.fn(),
  mockCampaignFindUnique: vi.fn(),
  mockContactFindMany: vi.fn(),
  mockRecipientCreate: vi.fn(),
  mockCampaignUpdate: vi.fn(),
}));

// Mock inngest client
vi.mock("@/inngest/client", () => ({
  inngest: {
    createFunction: (_opts: unknown, fn: unknown) => fn,
    send: sendMock,
  },
}));

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: mockCampaignFindUnique, update: mockCampaignUpdate },
    contact: { findMany: mockContactFindMany },
    campaignRecipient: { create: mockRecipientCreate },
  },
}));

// Mock audience resolver
vi.mock("@/lib/campaigns/audience", () => ({
  resolveAudience: vi.fn(async () => ["contact1", "contact2"]),
}));

// Mock throttle jitter
vi.mock("@/lib/campaigns/throttle", () => ({
  jitterSeconds: () => 1,
}));

import { campaignStartHandler } from "@/inngest/functions/campaign-start";

describe("campaignStartHandler", () => {
  beforeEach(() => {
    sendMock.mockReset();
    mockCampaignFindUnique.mockReset();
    mockContactFindMany.mockReset();
    mockRecipientCreate.mockReset();
    mockCampaignUpdate.mockReset();
  });

  it("creates recipients and emits campaign.send-one for each PENDING recipient", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "camp1",
      ownerId: "user1",
      filterJson: { contactIds: ["contact1", "contact2"] },
      template: { body: "Hi {{firstName}}, this is {{senderFirstName}}" },
      owner: { name: "Daniel Levi", title: "CEO", org: { name: "Triolla" } },
    });
    mockContactFindMany.mockResolvedValue([
      { id: "contact1", fullName: "Alice Cohen", currentCompany: "Acme", currentTitle: "CTO" },
      { id: "contact2", fullName: "Bob Katz", currentCompany: "Beta", currentTitle: "VP" },
    ]);
    mockRecipientCreate.mockImplementation(async ({ data }: { data: { contactId: string; status: string; renderedBody: string } }) => ({
      id: `rec-${data.contactId}`,
      ...data,
    }));
    mockCampaignUpdate.mockResolvedValue({});

    await campaignStartHandler({ event: { data: { campaignId: "camp1" } } });

    expect(mockRecipientCreate).toHaveBeenCalledTimes(2);
    // Both recipients are PENDING (have firstName)
    const calls = mockRecipientCreate.mock.calls;
    expect(calls[0][0].data.status).toBe("PENDING");
    expect(calls[0][0].data.renderedBody).toContain("Alice");
    expect(calls[0][0].data.renderedBody).toContain("Daniel");
    // 2 send-one events emitted
    const sentEvents = sendMock.mock.calls.map((c: [{ name: string }]) => c[0]);
    expect(sentEvents.filter((e: { name: string }) => e.name === "campaign.send-one")).toHaveLength(2);
    // Campaign updated to RUNNING
    expect(mockCampaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RUNNING" }) })
    );
  });

  it("marks recipient SKIPPED when required variable missing", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "camp1",
      ownerId: "user1",
      filterJson: { contactIds: ["contact1"] },
      template: { body: "Hi {{firstName}}" },
      owner: { name: "Daniel Levi", title: "CEO", org: { name: "Triolla" } },
    });
    mockContactFindMany.mockResolvedValue([
      { id: "contact1", fullName: null, currentCompany: null, currentTitle: null },
    ]);
    mockRecipientCreate.mockResolvedValue({ id: "rec1" });
    mockCampaignUpdate.mockResolvedValue({});

    await campaignStartHandler({ event: { data: { campaignId: "camp1" } } });

    const createCall = mockRecipientCreate.mock.calls[0][0].data;
    expect(createCall.status).toBe("SKIPPED");
    expect(createCall.errorMessage).toContain("missing_variable");
    // No send-one emitted for skipped
    const sentEvents = sendMock.mock.calls.map((c: [{ name: string }]) => c[0]);
    expect(sentEvents.filter((e: { name: string }) => e.name === "campaign.send-one")).toHaveLength(0);
  });
});
