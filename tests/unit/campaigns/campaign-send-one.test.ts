import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const publishMock = vi.hoisted(() => vi.fn());
const checkSendQuotaMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_opts: unknown, fn: unknown) => fn, send: sendMock },
}));
vi.mock("@/lib/campaigns/throttle", () => ({
  checkSendQuota: checkSendQuotaMock,
  jitterSeconds: () => 1,
}));
vi.mock("@/lib/linkedin/mcp-client", () => ({
  LinkedinMcp: { open: openMock },
  RateLimitError: class RateLimitError extends Error { name = "RateLimitError"; },
}));
vi.mock("@/lib/linkedin/sse-bus", () => ({ publish: publishMock }));
vi.mock("@/lib/linkedin/cookie-crypto", () => ({ decryptCookie: (s: string) => s }));

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
  campaign: {
    id: "camp1",
    ownerId: "user1",
    templateId: "tpl1",
    status: "RUNNING",
    owner: {
      linkedinSession: { encryptedCookie: "cookie123" },
    },
  },
  contact: { linkedinUrn: "urn:li:fs_miniProfile:abc" },
  ...overrides,
});

describe("campaignSendOneHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkSendQuotaMock.mockResolvedValue({ ok: true });
    openMock.mockResolvedValue({
      sendMessage: vi.fn().mockResolvedValue({ messageId: "msg1" }),
      close: vi.fn(),
    });
    mockRecipientUpdate.mockResolvedValue({});
    mockSentMessageCreate.mockResolvedValue({ id: "sent1", status: "SENT" });
    mockCampaignUpdate.mockResolvedValue({});
    mockAuditCreate.mockResolvedValue({});
    sendMock.mockResolvedValue({});
  });

  it("sends message, marks SENT, writes SentMessage, publishes SSE", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient());

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(mockRecipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
    expect(mockSentMessageCreate).toHaveBeenCalledOnce();
    expect(publishMock).toHaveBeenCalledWith("user1", expect.objectContaining({ type: "campaign:sent" }));
    // finalize always emitted
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.finalize" }));
  });

  it("re-emits and returns early when quota exceeded", async () => {
    checkSendQuotaMock.mockResolvedValue({ ok: false, retryAfterSec: 3600, reason: "hour" });
    mockRecipientFindUnique.mockResolvedValue(makeRecipient());

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.send-one" }));
    expect(openMock).not.toHaveBeenCalled();
    expect(mockSentMessageCreate).not.toHaveBeenCalled();
  });

  it("pauses campaign when no LinkedIn session", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient({
      campaign: { id: "camp1", ownerId: "user1", templateId: "tpl1", status: "RUNNING", owner: { linkedinSession: null } },
    }));

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(mockRecipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorMessage: "not_authenticated" }) })
    );
    expect(mockCampaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAUSED" }) })
    );
  });

  it("returns early if recipient not PENDING or campaign not RUNNING", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient({ status: "SENT" }));
    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });
    expect(openMock).not.toHaveBeenCalled();
  });
});
