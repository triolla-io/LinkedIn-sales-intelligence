import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignalFindUniqueOrThrow = vi.fn();
const mockContactFindMany = vi.fn();
const mockDraftFindUnique = vi.fn();
const mockDraftCreate = vi.fn();
const mockListUpsert = vi.fn();
const mockMemberUpsert = vi.fn();
const mockSignalUpdate = vi.fn();
const mockTransaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    companySignal: {
      findUniqueOrThrow: (...a: unknown[]) => mockSignalFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockSignalUpdate(...a),
    },
    contact: { findMany: (...a: unknown[]) => mockContactFindMany(...a) },
    companySignalDraft: {
      findUnique: (...a: unknown[]) => mockDraftFindUnique(...a),
      create: (...a: unknown[]) => mockDraftCreate(...a),
    },
    contactList: { upsert: (...a: unknown[]) => mockListUpsert(...a) },
    contactListMember: { upsert: (...a: unknown[]) => mockMemberUpsert(...a) },
    $transaction: (ops: unknown[]) => mockTransaction(ops),
  },
}));

vi.mock("@/lib/company-signals/draft", () => ({ draftCongrats: vi.fn() }));

import { createDraftsForSignal } from "@/lib/company-signals/create-drafts";
import { draftCongrats } from "@/lib/company-signals/draft";

const mockDraft = vi.mocked(draftCongrats);

beforeEach(() => {
  vi.clearAllMocks();
  mockSignalFindUniqueOrThrow.mockResolvedValue({
    id: "sig1", signalType: "FUNDING", title: "Raised $10M", summary: "Series A",
    company: { id: "co1", name: "Acme" },
  });
  mockContactFindUnique_default();
  mockDraftFindUnique.mockResolvedValue(null);
  mockListUpsert.mockResolvedValue({ id: "list1" });
  // Sentinel return values so we can assert both ops are handed to $transaction together.
  mockDraftCreate.mockReturnValue({ __op: "draftCreate" });
  mockMemberUpsert.mockReturnValue({ __op: "memberUpsert" });
  mockDraft.mockResolvedValue("דנה, מזל טוב על הגיוס!");
});
function mockContactFindUnique_default() {
  mockContactFindMany.mockResolvedValue([
    { id: "ct1", ownerId: "o1", fullName: "Dana Cohen", hebrewFirstName: "דנה", currentTitle: "CEO" },
  ]);
}

describe("createDraftsForSignal", () => {
  it("creates a draft per C-level contact and sets signal DRAFTED", async () => {
    const res = await createDraftsForSignal("sig1");
    expect(res.created).toBe(1);
    expect(mockDraftCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ signalId: "sig1", contactId: "ct1", ownerId: "o1", status: "PENDING_REVIEW" }),
    }));
    expect(mockSignalUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DRAFTED" } }));
    // The draft-create and list-member-upsert must be wrapped together in a single
    // $transaction so a mid-write crash can't leave a draft without its list membership.
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([{ __op: "draftCreate" }, { __op: "memberUpsert" }]),
    );
    expect(mockTransaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("is idempotent — skips a contact that already has a draft", async () => {
    mockDraftFindUnique.mockResolvedValue({ id: "existing" });
    const res = await createDraftsForSignal("sig1");
    expect(mockDraftCreate).not.toHaveBeenCalled();
    expect(res.created).toBe(0);
  });
});
