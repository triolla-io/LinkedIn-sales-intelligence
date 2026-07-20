import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTaskFindUnique = vi.fn();
const mockDraftFindUnique = vi.fn();
const mockDraftUpdate = vi.fn();
const mockDraftUpdateMany = vi.fn();
const mockSentCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    extensionTask: { findUnique: (...a: unknown[]) => mockTaskFindUnique(...a) },
    companySignalDraft: {
      findUnique: (...a: unknown[]) => mockDraftFindUnique(...a),
      update: (...a: unknown[]) => mockDraftUpdate(...a),
      updateMany: (...a: unknown[]) => mockDraftUpdateMany(...a),
    },
    sentMessage: { create: (...a: unknown[]) => mockSentCreate(...a) },
  },
}));
vi.mock("@/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: vi.fn() } }));
vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: {} }));
vi.mock("@/lib/sequences/gating", () => ({ maybeCompleteEnrollment: vi.fn() }));
vi.mock("@/lib/prospecting/candidates", () => ({ persistCandidates: vi.fn() }));
vi.mock("@/lib/prospecting/connect-scheduler", () => ({ queueNextConnect: vi.fn(), releaseConnectSlot: vi.fn(), SEARCH_FAIL_CAP: 3 }));
vi.mock("@/lib/prospecting/search-url", () => ({ buildSearchUrl: vi.fn(), parseSearchTitles: vi.fn() }));
vi.mock("@/lib/prospecting/events", () => ({ logProspectingEvent: vi.fn() }));
vi.mock("@/lib/prospecting/company-discovery", () => ({
  buildCompanySearchUrl: vi.fn(), enqueueCompanySearchTask: vi.fn(), failCompanyTarget: vi.fn(),
  interCompanyDelayMs: vi.fn(), maybeCompleteCompanyRun: vi.fn(), startNextPendingTarget: vi.fn(),
}));

import { extensionTaskResultHandler } from "@/inngest/functions/extension-task-result";

beforeEach(() => {
  vi.clearAllMocks();
  mockSentCreate.mockResolvedValue({ id: "sm1", sentAt: new Date() });
  mockDraftFindUnique.mockResolvedValue({ id: "d1", contactId: "c1" });
});

describe("extension-task-result — company signal drafts", () => {
  it("SEND success flips the draft to SENT", async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: "t1", kind: "SEND", status: "DONE", userId: "u1",
      companySignalDraftId: "d1", result: {}, payload: { text: "מזל טוב" },
    });
    await extensionTaskResultHandler({ event: { data: { taskId: "t1" } } });
    expect(mockSentCreate).toHaveBeenCalledOnce();
    expect(mockDraftUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
  });

  it("SEND failure reverts APPROVED → PENDING_REVIEW", async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: "t1", kind: "SEND", status: "FAILED", userId: "u1",
      companySignalDraftId: "d1", result: {}, payload: {},
    });
    await extensionTaskResultHandler({ event: { data: { taskId: "t1" } } });
    expect(mockDraftUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "d1", status: "APPROVED" }, data: { status: "PENDING_REVIEW" },
    }));
  });
});
