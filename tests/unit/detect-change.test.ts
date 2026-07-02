import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactUpdate = vi.fn();
const mockListUpsert = vi.fn();
const mockChangeCreate = vi.fn();
const mockMemberUpsert = vi.fn();
const mockTransaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { update: (...a: unknown[]) => mockContactUpdate(...a) },
    contactList: { upsert: (...a: unknown[]) => mockListUpsert(...a) },
    contactJobChange: { create: (...a: unknown[]) => mockChangeCreate(...a) },
    contactListMember: { upsert: (...a: unknown[]) => mockMemberUpsert(...a) },
    $transaction: (ops: unknown[]) => mockTransaction(ops),
  },
}));

import { recordJobChangeIfAny } from "@/lib/job-check/detect-change";

beforeEach(() => {
  vi.clearAllMocks();
  mockListUpsert.mockResolvedValue({ id: "list1" });
  mockContactUpdate.mockResolvedValue({});
});

describe("recordJobChangeIfAny", () => {
  it("returns no_change and only bumps lastJobCheckAt when nothing differs", async () => {
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: "PM", freshCompany: "Acme",
    });
    expect(res).toEqual({ result: "no_change", titleChanged: false, companyChanged: false });
    expect(mockChangeCreate).not.toHaveBeenCalled();
    expect(mockContactUpdate).toHaveBeenCalledOnce();
  });

  it("ignores null fresh values (treats as no signal)", async () => {
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: null, freshCompany: null,
    });
    expect(res.result).toBe("no_change");
  });

  it("records a change when title differs", async () => {
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: "VP Product", freshCompany: "Acme",
    });
    expect(res).toEqual({ result: "change_detected", titleChanged: true, companyChanged: false });
    expect(mockTransaction).toHaveBeenCalledOnce();
    const createArg = mockChangeCreate.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      contactId: "c1", prevTitle: "PM", newTitle: "VP Product",
      prevCompany: "Acme", newCompany: "Acme",
    });
  });
});
