import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Adding ONE person must prepare that person only. Whole-cohort behaviour has to stay
 * byte-identical when no ids are passed — tech-radar.run-marked depends on it — and an
 * empty id list must mean nobody, never everybody: the difference between researching
 * one company and researching every employer on a 2,000-contact list.
 */

const contactFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { contact: { findMany: (...a: unknown[]) => contactFindMany(...a) } },
}));

const { markedEmployers } = await import("@/lib/tech-radar/population");

beforeEach(() => {
  contactFindMany.mockReset();
  contactFindMany.mockResolvedValue([]);
});

describe("markedEmployers scoping", () => {
  it("asks for the whole marked cohort when no ids are given", async () => {
    await markedEmployers("owner1");
    expect(contactFindMany.mock.calls[0][0].where).toEqual({
      ownerId: "owner1",
      removedAt: null,
      radarInclude: true,
    });
  });

  it("narrows to the given contacts without dropping the radar filter", async () => {
    await markedEmployers("owner1", ["ct1"]);
    expect(contactFindMany.mock.calls[0][0].where).toMatchObject({
      ownerId: "owner1",
      removedAt: null,
      radarInclude: true,
      id: { in: ["ct1"] },
    });
  });

  it("an empty id list means nobody, not everybody", async () => {
    await markedEmployers("owner1", []);
    expect(contactFindMany.mock.calls[0][0].where).toMatchObject({ id: { in: [] } });
  });
});
