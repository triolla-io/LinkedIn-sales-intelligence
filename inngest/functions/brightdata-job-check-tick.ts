// inngest/functions/brightdata-job-check-tick.ts
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { priorityTitleWhere } from "@/lib/job-check/priority-titles";
import { brightDataRemaining, addBrightDataSpend } from "@/lib/brightdata/budget";
import { triggerProfileCollection } from "@/lib/brightdata/client";

const DAILY_CAP = 167; // ~5000 / 30 days — keeps the free tier from draining in one run

export const brightdataJobCheckTick = inngest.createFunction(
  { id: "brightdata-job-check-tick", name: "Bright Data job-check (daily)", triggers: [{ cron: "0 3 * * *" }] },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);

    // Distinct orgs with priority contacts due for a check.
    const due = await step.run("select-due", () =>
      prisma.contact.findMany({
        // Two OR groups (priority-title + due-for-check) cannot both sit at top level in
        // Prisma, so combine them under AND.
        where: {
          linkedinUrl: { not: "" },
          removedAt: null,
          AND: [
            priorityTitleWhere(),
            { OR: [{ lastJobCheckAt: null }, { lastJobCheckAt: { lt: cutoff } }] },
          ],
        },
        select: { id: true, ownerId: true, linkedinUrl: true, jobSnapshotTitle: true, jobSnapshotCompany: true },
        orderBy: { lastJobCheckAt: "asc" },
        take: 2000,
      })
    );

    if (due.length === 0) return { triggered: 0 };

    // Group by owner and cap per-owner by remaining budget + daily cap.
    const byOwner = new Map<string, typeof due>();
    for (const c of due) {
      const arr = byOwner.get(c.ownerId) ?? [];
      arr.push(c);
      byOwner.set(c.ownerId, arr);
    }

    let triggeredTotal = 0;
    for (const [ownerId, contacts] of byOwner) {
      const remaining = await step.run(`budget-${ownerId}`, () => brightDataRemaining(ownerId));
      const take = Math.min(DAILY_CAP, remaining, contacts.length);
      if (take <= 0) continue;

      const batch = contacts.slice(0, take);
      const { snapshotId } = await step.run(`trigger-${ownerId}`, () =>
        triggerProfileCollection(batch.map((c) => c.linkedinUrl))
      );
      await step.run(`spend-${ownerId}`, () => addBrightDataSpend(ownerId, batch.length));

      await step.sendEvent(`emit-${ownerId}`, {
        name: "brightdata.job-check.collect" as const,
        data: {
          ownerId,
          snapshotId,
          contacts: batch.map((c) => ({
            id: c.id,
            linkedinUrl: c.linkedinUrl,
            jobSnapshotTitle: c.jobSnapshotTitle,
            jobSnapshotCompany: c.jobSnapshotCompany,
          })),
        },
      });
      triggeredTotal += batch.length;
    }

    return { triggered: triggeredTotal };
  }
);
