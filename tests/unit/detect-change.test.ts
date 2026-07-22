import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactUpdate = vi.fn();
const mockContactFindUniqueOrThrow = vi.fn();
const mockListUpsert = vi.fn();
const mockChangeCreate = vi.fn();
const mockMemberUpsert = vi.fn();
const mockTransaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      update: (...a: unknown[]) => mockContactUpdate(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockContactFindUniqueOrThrow(...a),
    },
    contactList: { upsert: (...a: unknown[]) => mockListUpsert(...a) },
    contactJobChange: { create: (...a: unknown[]) => mockChangeCreate(...a) },
    contactListMember: { upsert: (...a: unknown[]) => mockMemberUpsert(...a) },
    $transaction: (ops: unknown[]) => mockTransaction(ops),
  },
}));

vi.mock("@/lib/job-check/judge-change", () => ({
  judgeJobChange: vi.fn(),
}));

import { recordJobChangeIfAny } from "@/lib/job-check/detect-change";
import { judgeJobChange } from "@/lib/job-check/judge-change";

const mockJudge = vi.mocked(judgeJobChange);

beforeEach(() => {
  vi.clearAllMocks();
  mockListUpsert.mockResolvedValue({ id: "list1" });
  mockContactUpdate.mockResolvedValue({});
  mockContactFindUniqueOrThrow.mockResolvedValue({ fullName: "Dana Cohen", hebrewFirstName: "דנה" });
});

describe("recordJobChangeIfAny", () => {
  it("returns no_change and only bumps lastJobCheckAt when nothing differs", async () => {
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: "PM", freshCompany: "Acme",
    });
    expect(res).toEqual({ result: "no_change", changeType: null });
    expect(mockChangeCreate).not.toHaveBeenCalled();
    expect(mockContactUpdate).toHaveBeenCalledOnce();
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it("ignores null fresh values (treats as no signal)", async () => {
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: null, freshCompany: null,
    });
    expect(res.result).toBe("no_change");
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it("returns variant_only and advances snapshot silently when judge says 'none'", async () => {
    mockJudge.mockResolvedValue({ changeType: "none", draftMessage: null });
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "Driver", snapshotCompany: "Egged Israel Transport Cooperative Society Ltd",
      freshTitle: "Driver", freshCompany: "Egged Transportation Company Ltd",
    });
    expect(res).toEqual({ result: "variant_only", changeType: null });
    expect(mockChangeCreate).not.toHaveBeenCalled();
    expect(mockContactUpdate).toHaveBeenCalledOnce();
  });

  it("suppresses a promotion — advances snapshot, no card (headline-derived title is noisy)", async () => {
    mockJudge.mockResolvedValue({ changeType: "promotion", draftMessage: "מזל טוב!" });
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: "Senior PM", freshCompany: "Acme",
    });
    expect(res).toEqual({ result: "title_suppressed", changeType: null });
    expect(mockChangeCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockContactUpdate).toHaveBeenCalledOnce();
  });

  it("suppresses a title_change — advances snapshot, no card", async () => {
    mockJudge.mockResolvedValue({ changeType: "title_change", draftMessage: "מזל טוב!" });
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: "PM | Building the future", freshCompany: "Acme",
    });
    expect(res).toEqual({ result: "title_suppressed", changeType: null });
    expect(mockChangeCreate).not.toHaveBeenCalled();
  });

  it("records a change and draft when judge detects a real move", async () => {
    mockJudge.mockResolvedValue({ changeType: "company_move", draftMessage: "מזל טוב!" });
    const res = await recordJobChangeIfAny({
      contactId: "c1", ownerId: "o1",
      snapshotTitle: "PM", snapshotCompany: "Acme",
      freshTitle: "VP Product", freshCompany: "Wint",
    });
    expect(res).toEqual({ result: "change_detected", changeType: "company_move" });
    expect(mockTransaction).toHaveBeenCalledOnce();
    const createArg = mockChangeCreate.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      contactId: "c1",
      prevTitle: "PM", newTitle: "VP Product",
      prevCompany: "Acme", newCompany: "Wint",
      changeType: "COMPANY_MOVE",
      draftMessage: "מזל טוב!",
    });
  });
});
