import { describe, it, expect, vi, beforeEach } from "vitest";

const createManyMock = vi.hoisted(() => vi.fn());
const updateManyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingCompanyTarget: {
      createMany: createManyMock,
      updateMany: updateManyMock,
    },
  },
}));

import { insertCompanyTargets } from "@/lib/prospecting/company-targets";

const COMPANY = {
  name: "Acme",
  nameHebrew: null,
  linkedinUrl: "https://www.linkedin.com/company/acme",
  linkedinSlug: "acme",
  website: null,
  vertical: null,
  dedupKey: "acme",
};

describe("insertCompanyTargets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts with skipDuplicates and reports added/skippedExisting", async () => {
    createManyMock.mockResolvedValue({ count: 1 });
    updateManyMock.mockResolvedValue({ count: 0 });
    const res = await insertCompanyTargets(
      "run1",
      [COMPANY, { ...COMPANY, name: "Acme dup" }],
      2,
    );
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ runId: "run1", dedupKey: "acme" }),
        expect.objectContaining({ runId: "run1", dedupKey: "acme" }),
      ],
      skipDuplicates: true,
    });
    expect(res).toEqual({ added: 1, skippedExisting: 1, skippedInvalid: 2 });
  });

  it("revives REMOVED targets matching incoming dedup keys", async () => {
    createManyMock.mockResolvedValue({ count: 0 });
    updateManyMock.mockResolvedValue({ count: 1 });
    const res = await insertCompanyTargets("run1", [COMPANY]);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { runId: "run1", dedupKey: { in: ["acme"] }, status: "REMOVED" },
      data: { status: "PENDING", error: null },
    });
    expect(res).toEqual({ added: 1, skippedExisting: 0, skippedInvalid: 0 });
  });

  it("short-circuits on empty input", async () => {
    const res = await insertCompanyTargets("run1", [], 3);
    expect(createManyMock).not.toHaveBeenCalled();
    expect(res).toEqual({ added: 0, skippedExisting: 0, skippedInvalid: 3 });
  });
});
