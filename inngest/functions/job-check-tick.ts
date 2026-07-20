import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { selectDueContacts } from "@/lib/job-check/select-due-contacts";

const DAILY_CAP = 25; // conservative profile-visit budget/run

export const jobCheckTick = inngest.createFunction(
  { id: "job-check-tick", triggers: [{ cron: "0 2 * * *" }] },
  async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);

    const due = await prisma.contact.findMany({
      where: {
        linkedinUrl: { not: "" },
        removedAt: null,
        OR: [{ lastJobCheckAt: null }, { lastJobCheckAt: { lt: cutoff } }],
      },
      select: { id: true, ownerId: true, linkedinUrl: true, lastJobCheckAt: true },
      orderBy: { lastJobCheckAt: { sort: "asc", nulls: "first" } }, // oldest/never-checked-first so the queue drains evenly
      take: 500,
    });

    const byOwner = new Map<string, typeof due>();
    for (const c of due) {
      const arr = byOwner.get(c.ownerId) ?? [];
      arr.push(c);
      byOwner.set(c.ownerId, arr);
    }
    const chosen = [...byOwner.values()].flatMap((rows) => selectDueContacts(rows, DAILY_CAP));

    if (chosen.length === 0) return { dispatched: 0 };

    const pending = await prisma.extensionTask.findMany({
      where: { kind: "SCRAPE_PROFILE", status: "PENDING" },
      select: { payload: true },
    });
    const alreadyQueued = new Set(
      pending.map((t) => (t.payload as { contactId?: string })?.contactId).filter(Boolean)
    );
    const toCreate = chosen.filter((c) => !alreadyQueued.has(c.id));
    if (toCreate.length === 0) return { dispatched: 0 };

    await prisma.extensionTask.createMany({
      data: toCreate.map((c) => ({
        userId: c.ownerId,
        kind: "SCRAPE_PROFILE" as const,
        payload: { contactId: c.id, linkedinUrl: c.linkedinUrl },
      })),
    });

    return { dispatched: toCreate.length };
  }
);
