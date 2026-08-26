import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactFindMany = vi.fn();
const mockExtensionTaskUpdateMany = vi.fn();
const mockExtensionTaskFindMany = vi.fn();
const mockExtensionTaskCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: (...a: unknown[]) => mockContactFindMany(...a) },
    extensionTask: {
      updateMany: (...a: unknown[]) => mockExtensionTaskUpdateMany(...a),
      findMany: (...a: unknown[]) => mockExtensionTaskFindMany(...a),
      createMany: (...a: unknown[]) => mockExtensionTaskCreateMany(...a),
    },
  },
}));

const contactRow = (id: string, ownerId = "o1") => ({
  id,
  ownerId,
  linkedinUrl: `https://linkedin.com/in/${id}`,
  lastJobCheckAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockExtensionTaskUpdateMany.mockResolvedValue({ count: 0 });
  mockExtensionTaskFindMany.mockResolvedValue([]);
  mockExtensionTaskCreateMany.mockResolvedValue({ count: 0 });
});

describe("dispatchJobChecks backlog expiry", () => {
  it("cancels PENDING SCRAPE_PROFILE tasks older than PENDING_EXPIRY_DAYS before deduping", async () => {
    mockContactFindMany.mockResolvedValue([]);
    const { dispatchJobChecks, PENDING_EXPIRY_DAYS } = await import("@/lib/job-check/dispatch");

    const before = Date.now();
    await dispatchJobChecks();

    expect(mockExtensionTaskUpdateMany).toHaveBeenCalledWith({
      where: {
        kind: "SCRAPE_PROFILE",
        status: "PENDING",
        createdAt: { lt: expect.any(Date) },
      },
      data: { status: "CANCELLED", errorCode: "expired_unclaimed" },
    });

    const call = mockExtensionTaskUpdateMany.mock.calls[0][0];
    const cutoff = call.where.createdAt.lt as Date;
    const expectedMs = PENDING_EXPIRY_DAYS * 86_400_000;
    // The cutoff should sit ~PENDING_EXPIRY_DAYS ago, measured against the same
    // dispatch call — allow a small window for test execution time.
    expect(before - cutoff.getTime()).toBeGreaterThan(expectedMs - 5_000);
    expect(before - cutoff.getTime()).toBeLessThan(expectedMs + 5_000);
  });

  it("dedups against CLAIMED tasks too, not only PENDING", async () => {
    mockContactFindMany.mockResolvedValue([contactRow("c1")]);
    // c1 already has a CLAIMED task queued — must not be re-created.
    mockExtensionTaskFindMany.mockResolvedValue([{ payload: { contactId: "c1" } }]);

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    expect(mockExtensionTaskFindMany).toHaveBeenCalledWith({
      where: { kind: "SCRAPE_PROFILE", status: { in: ["PENDING", "CLAIMED"] } },
      select: { payload: true },
    });
    expect(mockExtensionTaskCreateMany).not.toHaveBeenCalled();
    expect(created).toBe(0);
  });
});
