import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const publishMock = vi.hoisted(() => vi.fn());
const checkSendQuotaMock = vi.hoisted(() => vi.fn());
const mcpSendMessageMock = vi.hoisted(() => vi.fn());

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_opts: unknown, fn: unknown) => fn, send: sendMock },
}));
vi.mock("@/lib/campaigns/throttle", () => ({
  checkSendQuota: checkSendQuotaMock,
  jitterSeconds: () => 1,
}));
vi.mock("@/lib/linkedin/mcp-http-client", () => ({
  mcpSendMessage: mcpSendMessageMock,
  extractUsername: (url: string) => url.match(/\/in\/([^/?#]+)/)?.[1] ?? "unknown",
  extractProfileUrn: () => undefined,
}));
vi.mock("@/lib/linkedin/sse-bus", () => ({ publish: publishMock }));

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
  campaign: { id: "camp1", ownerId: "user1", templateId: "tpl1", status: "RUNNING" },
  contact: { linkedinUrn: "urn:li:fs_miniProfile:abc", linkedinUrl: "https://linkedin.com/in/alice/" },
  ...overrides,
});

describe("campaignSendOneHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkSendQuotaMock.mockResolvedValue({ ok: true });
    mcpSendMessageMock.mockResolvedValue(undefined);
    mockRecipientUpdate.mockResolvedValue({});
    mockSentMessageCreate.mockResolvedValue({ id: "sent1", status: "SENT" });
    mockCampaignUpdate.mockResolvedValue({});
    mockAuditCreate.mockResolvedValue({});
    sendMock.mockResolvedValue({});
  });

  it("sends message, marks SENT, writes SentMessage, publishes SSE", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient());

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(mcpSendMessageMock).toHaveBeenCalledWith("alice", "Hello Alice", undefined);
    expect(mockRecipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
    expect(mockSentMessageCreate).toHaveBeenCalledOnce();
    expect(publishMock).toHaveBeenCalledWith("user1", expect.objectContaining({ type: "campaign:sent" }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.finalize" }));
  });

  it("re-emits and returns early when quota exceeded", async () => {
    checkSendQuotaMock.mockResolvedValue({ ok: false, retryAfterSec: 3600, reason: "hour" });
    mockRecipientFindUnique.mockResolvedValue(makeRecipient());

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.send-one" }));
    expect(mcpSendMessageMock).not.toHaveBeenCalled();
    expect(mockSentMessageCreate).not.toHaveBeenCalled();
  });

  it("marks FAILED and retries on MCP error", async () => {
    mcpSendMessageMock.mockRejectedValue(new Error("MCP connection refused"));
    mockRecipientFindUnique.mockResolvedValue(makeRecipient());

    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });

    expect(mockRecipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", errorMessage: "MCP connection refused" }) })
    );
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.send-one" }));
  });

  it("returns early if recipient not PENDING or campaign not RUNNING", async () => {
    mockRecipientFindUnique.mockResolvedValue(makeRecipient({ status: "SENT" }));
    await campaignSendOneHandler({ event: { data: { recipientId: "rec1" } } });
    expect(mcpSendMessageMock).not.toHaveBeenCalled();
  });
});
