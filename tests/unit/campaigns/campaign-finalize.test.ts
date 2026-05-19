import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_opts: unknown, fn: unknown) => fn, send: sendMock },
}));

const mockCount = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaignRecipient: { count: mockCount },
    campaign: { findUnique: mockFindUnique, update: mockUpdate },
  },
}));

import { campaignFinalizeHandler } from "@/inngest/functions/campaign-finalize";

describe("campaignFinalizeHandler", () => {
  beforeEach(() => { vi.clearAllMocks(); mockUpdate.mockResolvedValue({}); });

  it("marks campaign COMPLETED when no PENDING or SENDING remain", async () => {
    mockCount.mockResolvedValue(0);
    mockFindUnique.mockResolvedValue({ id: "camp1", status: "RUNNING" });

    await campaignFinalizeHandler({ event: { data: { campaignId: "camp1" } } });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
  });

  it("does nothing while PENDING recipients remain", async () => {
    mockCount.mockResolvedValue(2);

    await campaignFinalizeHandler({ event: { data: { campaignId: "camp1" } } });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does nothing if campaign not RUNNING", async () => {
    mockCount.mockResolvedValue(0);
    mockFindUnique.mockResolvedValue({ id: "camp1", status: "PAUSED" });

    await campaignFinalizeHandler({ event: { data: { campaignId: "camp1" } } });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
