import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDraftFindFirst = vi.fn();
const mockDraftUpdate = vi.fn();
const mockDraftUpdateMany = vi.fn();
const mockTaskCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    companySignalDraft: {
      findFirst: (...a: unknown[]) => mockDraftFindFirst(...a),
      update: (...a: unknown[]) => mockDraftUpdate(...a),
      updateMany: (...a: unknown[]) => mockDraftUpdateMany(...a),
    },
    extensionTask: { create: (...a: unknown[]) => mockTaskCreate(...a) },
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
    id: "d1", status: "PENDING_REVIEW",
    contact: { fullName: "Dana", linkedinUrl: "https://linkedin.com/in/dana" },
  });
  mockDraftUpdateMany.mockResolvedValue({ count: 1 });
});

describe("PATCH /api/company-signals/[id]", () => {
  it("approve creates a SEND ExtensionTask with companySignalDraftId", async () => {
    const res = await PATCH(reqWith("d1", { action: "approve", message: "מזל טוב!" }) as never);
    expect((res as Response).status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "SEND", companySignalDraftId: "d1", userId: "u1" }),
    }));
  });

  it("returns 409 when not pending (guarded transition)", async () => {
    mockDraftUpdateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(reqWith("d1", { action: "approve", message: "x" }) as never);
    expect((res as Response).status).toBe(409);
    expect(mockTaskCreate).not.toHaveBeenCalled();
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
