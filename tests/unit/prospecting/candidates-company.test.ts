import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.hoisted(() => vi.fn());
const requestFindMany = vi.hoisted(() => vi.fn());
const requestCreate = vi.hoisted(() => vi.fn());
const runUpdate = vi.hoisted(() => vi.fn());
const targetUpdate = vi.hoisted(() => vi.fn());
const eventCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: contactFindMany },
    connectionRequest: { findMany: requestFindMany, create: requestCreate },
    prospectingRun: { update: runUpdate },
    prospectingCompanyTarget: { update: targetUpdate },
    prospectingEvent: { create: eventCreate },
  },
}));

import { persistCandidates } from "@/lib/prospecting/candidates";

const CARD = {
  urn: "urn:li:member:jane-doe",
  profileUrl: "https://www.linkedin.com/in/jane-doe",
  name: "Jane Doe",
  headline: "CEO at Acme",
  title: "CEO",
  company: "Acme",
  location: "Tel Aviv",
  degree: "2nd",
  cardAction: "connect",
};

describe("persistCandidates with companyTargetId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contactFindMany.mockResolvedValue([]);
    requestFindMany.mockResolvedValue([]);
    requestCreate.mockResolvedValue({});
    runUpdate.mockResolvedValue({});
    targetUpdate.mockResolvedValue({});
  });

  it("stamps inserted rows with the companyTargetId and bumps discoveredCount", async () => {
    const res = await persistCandidates("user1", "run1", [CARD], "t1");
    expect(res).toEqual({ inserted: 1, skipped: 0 });
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyTargetId: "t1",
        status: "DISCOVERED",
      }),
    });
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { discoveredCount: { increment: 1 } },
    });
  });

  it("leaves keyword-run behavior unchanged when the param is omitted", async () => {
    await persistCandidates("user1", "run1", [CARD]);
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyTargetId: null }),
    });
    expect(targetUpdate).not.toHaveBeenCalled();
  });

  it("drops a card whose headline does not match matchTitle, creating no row", async () => {
    const offTitle = {
      ...CARD,
      urn: "urn:li:member:pa-person",
      profileUrl: "https://www.linkedin.com/in/pa-person",
      name: "PA Person",
      headline: "PA to VP Supply Chain Chief Procurement Officer",
      title: "PA to VP Supply Chain Chief Procurement Officer",
      company: null,
    };
    const res = await persistCandidates("user1", "run1", [offTitle], "t1", "CEO");
    expect(res).toEqual({ inserted: 0, skipped: 0 });
    expect(requestCreate).not.toHaveBeenCalled();
    expect(targetUpdate).not.toHaveBeenCalled();
  });

  it("keeps a card whose headline matches matchTitle", async () => {
    const onTitle = { ...CARD, headline: "Chief Executive Officer", title: "CEO", company: null };
    const res = await persistCandidates("user1", "run1", [onTitle], "t1", "CEO");
    expect(res).toEqual({ inserted: 1, skipped: 0 });
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyTargetId: "t1", status: "DISCOVERED" }),
    });
  });

  it("applies no title filter when matchTitle is omitted (keyword runs)", async () => {
    const offTitle = { ...CARD, headline: "Algorithm Engineer", title: "Algorithm Engineer" };
    const res = await persistCandidates("user1", "run1", [offTitle], "t1");
    expect(res).toEqual({ inserted: 1, skipped: 0 });
  });
});
