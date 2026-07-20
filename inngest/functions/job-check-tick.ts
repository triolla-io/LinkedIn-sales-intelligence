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
      orderBy: { lastJobCheckAt: "asc" }, // oldest-first so the queue drains evenly
      take: 500,
    });

    const chosen = selectDueContacts(due, DAILY_CAP);

    if (chosen.length === 0) return { dispatched: 0 };

    await prisma.extensionTask.createMany({
      data: chosen.map((c) => ({
        userId: c.ownerId,
        kind: "SCRAPE_PROFILE" as const,
        payload: { contactId: c.id, linkedinUrl: c.linkedinUrl },
      })),
    });

    return { dispatched: chosen.length };
  }
);
