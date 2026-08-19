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
    expect(res).toEqual({ inserted: 1, skipped: 0, filtered: 0, railLinks: 0 });
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyTargetId: "t1",
        status: "DISCOVERED",
      }),
    });
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { discoveredCount: { increment: 1 }, scannedCount: { increment: 1 } },
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
    expect(res).toEqual({ inserted: 0, skipped: 0, filtered: 1, railLinks: 0 });
    expect(requestCreate).not.toHaveBeenCalled();
    // The drop must still be COUNTED — an invisible drop is what made adi's run look empty.
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { scannedCount: { increment: 1 } },
    });
  });

  it("keeps a card whose headline matches matchTitle", async () => {
    const onTitle = { ...CARD, headline: "Chief Executive Officer", title: "CEO", company: null };
    const res = await persistCandidates("user1", "run1", [onTitle], "t1", "CEO");
    expect(res).toEqual({ inserted: 1, skipped: 0, filtered: 0, railLinks: 0 });
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyTargetId: "t1", status: "DISCOVERED" }),
    });
  });

  it("applies no title filter when matchTitle is omitted (keyword runs)", async () => {
    const offTitle = { ...CARD, headline: "Algorithm Engineer", title: "Algorithm Engineer" };
    const res = await persistCandidates("user1", "run1", [offTitle], "t1");
    expect(res).toEqual({ inserted: 1, skipped: 0, filtered: 0, railLinks: 0 });
  });
});

/**
 * Regression — the verbatim `"VP Product"` page from adi's Playtika run (2026-08-18 10:12).
 * Eight cards came back; the run recorded 0 found, 0 skipped and completed "successfully".
 * Post-fix: the one real product leader is inserted and the other seven are counted as filtered,
 * so a zero-yield page can never again look identical to a page that returned nothing.
 */
describe("persistCandidates — Playtika \"VP Product\" page (2026-08-18)", () => {
  const page = [
    ["Ofer Klein", "Product Group Manager at Playtika"],
    ["Eran Gefen", null],
    ["Enon Landenberg", null],
    ["Guy Ceder", "General Manager, WSOP at Playtika"],
    ["Guy Ben-dov", null],
    ["Yehuda Sabag", "GM | Playtika"],
    ["Eran Yarkoni", null],
    ["Danny Roup", null],
  ].map(([name, headline], i) => ({
    ...CARD,
    urn: `urn:li:member:p${i}`,
    profileUrl: `https://www.linkedin.com/in/p${i}`,
    name: name as string,
    headline: headline as string | null,
    title: headline as string | null,
    company: null,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    contactFindMany.mockResolvedValue([]);
    requestFindMany.mockResolvedValue([]);
    requestCreate.mockResolvedValue({});
    runUpdate.mockResolvedValue({});
    targetUpdate.mockResolvedValue({});
  });

  it("keeps the product leader and counts the seven it dropped", async () => {
    const res = await persistCandidates("user1", "run1", page, "t1", '"VP Product"');
    expect(res).toEqual({ inserted: 1, skipped: 0, filtered: 7, railLinks: 0 });
    expect(requestCreate).toHaveBeenCalledTimes(1);
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ fullName: "Ofer Klein", status: "DISCOVERED" }),
    });
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { discoveredCount: { increment: 1 }, scannedCount: { increment: 8 } },
    });
  });
});

/**
 * Rail links must not reach the pool, and must not inflate the scanned count either — they are not
 * people LinkedIn returned for the company, they are page furniture.
 */
describe("persistCandidates — name-only rail links", () => {
  const rail = (i: number) => ({
    ...CARD,
    urn: `urn:li:member:rail${i}`,
    profileUrl: `https://www.linkedin.com/in/rail${i}`,
    name: `Rail Person ${i}`,
    headline: null,
    title: null,
    company: null,
    location: null,
    degree: null,
    cardAction: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    contactFindMany.mockResolvedValue([]);
    requestFindMany.mockResolvedValue([]);
    requestCreate.mockResolvedValue({});
    runUpdate.mockResolvedValue({});
    targetUpdate.mockResolvedValue({});
  });

  it("drops them in a keyword run, where no title filter would have caught them", async () => {
    const res = await persistCandidates("user1", "run1", [rail(1), rail(2), rail(3), CARD]);
    expect(res.inserted).toBe(1);
    expect(res.railLinks).toBe(3);
    expect(requestCreate).toHaveBeenCalledTimes(1);
    expect(requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ fullName: "Jane Doe" }),
    });
  });

  it("does not count them as people scanned for a company", async () => {
    await persistCandidates("user1", "run1", [rail(1), rail(2), CARD], "t1", "CEO");
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { discoveredCount: { increment: 1 }, scannedCount: { increment: 1 } },
    });
  });
});
