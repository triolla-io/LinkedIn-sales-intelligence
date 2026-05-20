import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const checkSendQuotaMock = vi.hoisted(() => vi.fn());

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_opts: unknown, fn: unknown) => fn, send: sendMock },
}));
vi.mock("@/lib/campaigns/throttle", () => ({
  checkSendQuota: checkSendQuotaMock,
  jitterSeconds: () => 1,
}));

const mockRecipientFindUnique = vi.hoisted(() => vi.fn());
const mockRecipientUpdate = vi.hoisted(() => vi.fn());
const mockSentMessageCreate = vi.hoisted(() => vi.fn());
const mockCampaignUpdate = vi.hoisted(() => vi.fn());
const mockAuditCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaignRecipient: { findUnique: mockRecipientFindUnique, update: mockRecipientUpdate },
    sentMessage: { create: mockSentMessageCreate },
    campaign: { update: mockCampaignUpdate },
    auditEvent: { create: mockAuditCreate },
  },
}));

import { campaignSendOneHandler } from "@/inngest/functions/campaign-send-one";

const makeRecipient = (overrides = {}) => ({
  id: "rec1",
  status: "PENDING",
  renderedBody: "Hello Alice",
  contactId: "contact1",
  campaignId: "camp1",
  attemptCount: 0,
  campaign: { id: "camp1", ownerId: "user1", templateId: "tpl1", status: "RUNNING", channel: "LINKEDIN" },
  contact: { linkedinUrn: "urn:li:fs_miniProfile:abc", linkedinUrl: "https://linkedin.com/in/alice/" },
  ...overrides,
});

describe("campaignSendOneHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkSendQuotaMock.mockResolvedValue({ ok: true });
    mockRecipientUpdate.mockResolvedValue({});
    mockSentMessageCreate.mockResolvedValue({ id: "sent1", status: "SENT" });
    mockCampaignUpdate.mockResolvedValue({});
    mockAuditCreate.mockResolvedValue({});
    sendMock.mockResolvedValue({});
  });

  it("marks FAILED (after max attempts) when channel not yet implemented", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient({ attemptCount: 2 }));

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(mockRecipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.finalize" }));
  });

  it("marks PENDING and retries when channel not implemented and attempts remain", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient({ attemptCount: 0 }));

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(mockRecipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
    );
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.send-one" }));
  });

  it("re-emits and returns early when quota exceeded", async () => {
    checkSendQuotaMock.mockResolvedValue({ ok: false, retryAfterSec: 3600, reason: "hour" });
    mockRecipientFindUnique.mockResolvedValue(makeRecipient());

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.send-one" }));
    expect(mockRecipientUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENDING" }) })
    );
  });

  it("returns early if recipient not PENDING or campaign not RUNNING", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient({ status: "SENT" }));
    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });
    expect(checkSendQuotaMock).not.toHaveBeenCalled();
  });
});
