import { vi, beforeEach } from "vitest";

const mockContactCount = vi.fn();
const mockContactFindMany = vi.fn();
const mockChangeCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      count: (...a: unknown[]) => mockContactCount(...a),
      findMany: (...a: unknown[]) => mockContactFindMany(...a),
    },
    contactJobChange: { count: (...a: unknown[]) => mockChangeCount(...a) },
  },
}));

import { describe, it, expect } from "vitest";
import {
  startOfMonthTLV,
  nextCheckAt,
  isDueNow,
  coveragePct,
  estimateFullPassDays,
  eligibleContactWhere,
  computeJobChangeStats,
  CADENCE_DAYS,
  DAY_MS,
} from "@/lib/job-check/stats";

describe("startOfMonthTLV", () => {
  it("returns the UTC instant of the 1st of the month in Israel time", () => {
    // July 2026, Israel is UTC+3 (DST) → 2026-07-01T00:00:00+03:00
    const now = new Date("2026-07-20T10:00:00Z");
    expect(startOfMonthTLV(now).toISOString()).toBe("2026-06-30T21:00:00.000Z");
  });
});

describe("nextCheckAt", () => {
  it("adds the 28-day cadence", () => {
    const last = new Date("2026-07-01T00:00:00Z");
    expect(nextCheckAt(last).toISOString()).toBe(
      new Date(last.getTime() + CADENCE_DAYS * DAY_MS).toISOString()
    );
  });
});

describe("isDueNow", () => {
  const now = new Date("2026-07-20T00:00:00Z");
  it("is due when never checked", () => {
    expect(isDueNow(null, now)).toBe(true);
  });
  it("is due when the last check is older than the cadence", () => {
    expect(isDueNow(new Date("2026-06-01T00:00:00Z"), now)).toBe(true);
  });
  it("is not due when checked within the cadence", () => {
    expect(isDueNow(new Date("2026-07-15T00:00:00Z"), now)).toBe(false);
  });
});

describe("coveragePct", () => {
  it("rounds the percentage", () => {
    expect(coveragePct(60, 200)).toBe(30);
  });
  it("is 0 when there is nothing to cover", () => {
    expect(coveragePct(0, 0)).toBe(0);
  });
});

describe("estimateFullPassDays", () => {
  it("divides due-now by throughput and rounds up", () => {
    expect(estimateFullPassDays(40, 267)).toBe(1);
    expect(estimateFullPassDays(500, 267)).toBe(2);
  });
  it("is 0 when nothing is due", () => {
    expect(estimateFullPassDays(0, 267)).toBe(0);
  });
});

describe("eligibleContactWhere", () => {
  it("scopes to owner, excludes removed and blank LinkedIn", () => {
    expect(eligibleContactWhere("o1")).toEqual({
      ownerId: "o1",
      removedAt: null,
      linkedinUrl: { not: "" },
    });
  });
});

describe("computeJobChangeStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // contact.count is called 3× in order: eligibleTotal, coveredLast28d, scannedThisMonth
    mockContactCount
      .mockResolvedValueOnce(200)
      .mockResolvedValueOnce(60)
      .mockResolvedValueOnce(20);
    // contactJobChange.count is called 3× in order: company, role, pending
    mockChangeCount
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(3);
    mockContactFindMany.mockResolvedValue([
      {
        id: "c1",
        fullName: "Dana Cohen",
        linkedinUrl: "https://linkedin.com/in/dana",
        currentTitle: "PM",
        currentCompany: "Acme",
        lastJobCheckAt: new Date("2026-07-18T00:00:00Z"),
        jobChanges: [{ id: "jc1" }],
      },
    ]);
  });

  it("computes counts, derives dueNow, and shapes rows", async () => {
    const stats = await computeJobChangeStats("o1", new Date("2026-07-20T10:00:00Z"));
    expect(stats.eligibleTotal).toBe(200);
    expect(stats.coveredLast28d).toBe(60);
    expect(stats.scannedThisMonth).toBe(20);
    expect(stats.dueNow).toBe(140); // eligibleTotal - coveredLast28d
    expect(stats.changedCompanyThisMonth).toBe(5);
    expect(stats.changedRoleThisMonth).toBe(8);
    expect(stats.pendingReview).toBe(3);
    expect(stats.recentlyScanned).toHaveLength(1);
    expect(stats.recentlyScanned[0]).toMatchObject({
      id: "c1",
      fullName: "Dana Cohen",
      lastJobCheckAt: "2026-07-18T00:00:00.000Z",
      nextCheckAt: "2026-08-15T00:00:00.000Z", // +28d
      hasChange: true,
    });
  });

  it("scopes the first count query to the owner and eligibility", async () => {
    await computeJobChangeStats("o1", new Date("2026-07-20T10:00:00Z"));
    expect(mockContactCount.mock.calls[0][0]).toEqual({ where: eligibleContactWhere("o1") });
  });
});
