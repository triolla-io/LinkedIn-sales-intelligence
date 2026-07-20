import { prisma } from "@/lib/prisma";
import {
  CADENCE_DAYS,
  DAILY_THROUGHPUT_ESTIMATE,
  DAY_MS,
  eligibleContactWhere,
  nextCheckAt,
  startOfMonthTLV,
} from "@/lib/job-check/stats-pure";

// Re-export the client-safe helpers so existing server-side importers of this module
// keep working unchanged.
export * from "@/lib/job-check/stats-pure";

export type ScannedRow = {
  id: string;
  fullName: string;
  linkedinUrl: string;
  currentTitle: string | null;
  currentCompany: string | null;
  lastJobCheckAt: string;
  nextCheckAt: string;
  hasChange: boolean;
};

export type JobChangeStats = {
  scannedThisMonth: number;
  eligibleTotal: number;
  coveredLast28d: number;
  dueNow: number;
  changedCompanyThisMonth: number;
  changedRoleThisMonth: number;
  pendingReview: number;
  dailyThroughput: number;
  recentlyScanned: ScannedRow[];
};

export async function computeJobChangeStats(ownerId: string, now: Date): Promise<JobChangeStats> {
  const eligible = eligibleContactWhere(ownerId);
  const monthStart = startOfMonthTLV(now);
  const cutoff = new Date(now.getTime() - CADENCE_DAYS * DAY_MS);
  const byOwner = { contact: { ownerId } };

  const [
    eligibleTotal,
    coveredLast28d,
    scannedThisMonth,
    changedCompanyThisMonth,
    changedRoleThisMonth,
    pendingReview,
    recent,
  ] = await Promise.all([
    prisma.contact.count({ where: eligible }),
    prisma.contact.count({ where: { ...eligible, lastJobCheckAt: { gte: cutoff } } }),
    prisma.contact.count({ where: { ...eligible, lastJobCheckAt: { gte: monthStart } } }),
    prisma.contactJobChange.count({
      where: { ...byOwner, changeType: "COMPANY_MOVE", detectedAt: { gte: monthStart } },
    }),
    prisma.contactJobChange.count({
      where: { ...byOwner, changeType: { in: ["PROMOTION", "TITLE_CHANGE"] }, detectedAt: { gte: monthStart } },
    }),
    prisma.contactJobChange.count({ where: { ...byOwner, status: "PENDING_REVIEW" } }),
    prisma.contact.findMany({
      where: { ...eligible, lastJobCheckAt: { not: null } },
      orderBy: { lastJobCheckAt: "desc" },
      take: 50,
      select: {
        id: true,
        fullName: true,
        linkedinUrl: true,
        currentTitle: true,
        currentCompany: true,
        lastJobCheckAt: true,
        jobChanges: { select: { id: true }, take: 1 },
      },
    }),
  ]);

  return {
    scannedThisMonth,
    eligibleTotal,
    coveredLast28d,
    dueNow: eligibleTotal - coveredLast28d,
    changedCompanyThisMonth,
    changedRoleThisMonth,
    pendingReview,
    dailyThroughput: DAILY_THROUGHPUT_ESTIMATE,
    recentlyScanned: recent.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      linkedinUrl: r.linkedinUrl,
      currentTitle: r.currentTitle,
      currentCompany: r.currentCompany,
      lastJobCheckAt: r.lastJobCheckAt!.toISOString(),
      nextCheckAt: nextCheckAt(r.lastJobCheckAt!).toISOString(),
      hasChange: r.jobChanges.length > 0,
    })),
  };
}
