import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDraftFindFirst = vi.fn();
const mockDraftUpdate = vi.fn();
const mockDraftUpdateMany = vi.fn();
const mockTaskCreate = vi.fn();
const mockSentMessageCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    companySignalDraft: {
      findFirst: (...a: unknown[]) => mockDraftFindFirst(...a),
      update: (...a: unknown[]) => mockDraftUpdate(...a),
      updateMany: (...a: unknown[]) => mockDraftUpdateMany(...a),
    },
    extensionTask: {
      create: (...a: unknown[]) => mockTaskCreate(...a),
    },
    sentMessage: {
      create: (...a: unknown[]) => mockSentMessageCreate(...a),
    },
  },
  Prisma: { InputJsonValue: {} },
}));

// withTenant → call handler with a fixed ctx.
vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: (h: (req: unknown, ctx: unknown) => unknown) => (req: unknown) =>
    h(req, { effectiveUserId: "u1" }),
}));
vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: {} }));

import { PATCH } from "@/app/api/company-signals/[id]/route";

function reqWith(id: string, body: unknown) {
  return {
    nextUrl: { pathname: `/api/company-signals/${id}` },
    json: async () => body,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDraftFindFirst.mockResolvedValue({
    id: "d1", status: "PENDING_REVIEW", channel: "LINKEDIN",
    draftMessage: "מזל טוב!", emailBody: null, emailSubject: null,
    contact: { id: "c1", fullName: "Dana", linkedinUrl: "https://linkedin.com/in/dana", email: "dana@acme.co" },
  });
  mockDraftUpdateMany.mockResolvedValue({ count: 1 });
});

describe("PATCH /api/company-signals/[id] (prepare-not-send)", () => {
  it("prepare queues a PREPARE_MESSAGE task with companySignalDraftId and NO jitter", async () => {
    const res = await PATCH(reqWith("d1", { action: "prepare", message: "מזל טוב!" }) as never);
    expect((res as Response).status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "PREPARE_MESSAGE", companySignalDraftId: "d1", userId: "u1" }),
    }));
    // No scheduledFor → runs immediately (the user is waiting for the tab).
    expect(mockTaskCreate.mock.calls[0][0].data.scheduledFor).toBeUndefined();
    // The transition claims PENDING_REVIEW → APPROVED with the edited message.
    expect(mockDraftUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "PENDING_REVIEW" }),
      data: expect.objectContaining({ status: "APPROVED", channel: "LINKEDIN" }),
    }));
  });

  it("prepare never creates a SEND task or a SentMessage", async () => {
    await PATCH(reqWith("d1", { action: "prepare", message: "x" }) as never);
    const kinds = mockTaskCreate.mock.calls.map((c) => c[0].data.kind);
    expect(kinds).not.toContain("SEND");
    expect(mockSentMessageCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when not pending (guarded transition)", async () => {
    mockDraftUpdateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(reqWith("d1", { action: "prepare", message: "x" }) as never);
    expect((res as Response).status).toBe(409);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("prepared (email) records PREPARED without any task or send", async () => {
    const res = await PATCH(
      reqWith("d1", { action: "prepared", channel: "email", subject: "סחטיין", message: "היי דנה" }) as never
    );
    expect((res as Response).status).toBe(200);
    expect(mockDraftUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PREPARED", channel: "EMAIL", emailSubject: "סחטיין" }),
    }));
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockSentMessageCreate).not.toHaveBeenCalled();
  });

  it("sent confirms PREPARED → SENT and only then records a SentMessage", async () => {
    mockDraftFindFirst.mockResolvedValue({
      id: "d1", status: "PREPARED", channel: "LINKEDIN",
      draftMessage: "מזל טוב!", emailBody: null, emailSubject: null,
      contact: { id: "c1", fullName: "Dana", linkedinUrl: "https://linkedin.com/in/dana", email: null },
    });
    const res = await PATCH(reqWith("d1", { action: "sent" }) as never);
    expect((res as Response).status).toBe(200);
    expect(mockDraftUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "PREPARED" }),
      data: expect.objectContaining({ status: "SENT" }),
    }));
    expect(mockSentMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contactId: "c1", body: "מזל טוב!", status: "SENT" }),
    }));
  });

  it("sent returns 409 when the draft was never prepared", async () => {
    mockDraftUpdateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(reqWith("d1", { action: "sent" }) as never);
    expect((res as Response).status).toBe(409);
    expect(mockSentMessageCreate).not.toHaveBeenCalled();
  });

  it("dismiss sets DISMISSED without a task", async () => {
    const res = await PATCH(reqWith("d1", { action: "dismiss" }) as never);
    expect((res as Response).status).toBe(200);
    expect(mockDraftUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DISMISSED" } }));
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("404 when the draft is not owned by the caller", async () => {
    mockDraftFindFirst.mockResolvedValue(null);
    const res = await PATCH(reqWith("d1", { action: "dismiss" }) as never);
    expect((res as Response).status).toBe(404);
  });
});
