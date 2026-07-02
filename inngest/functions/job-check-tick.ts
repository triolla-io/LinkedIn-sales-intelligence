import { inngest } from "@/inngest/client";
import { priorityTitleWhere } from "@/lib/job-check/priority-titles";
import { prisma } from "@/lib/prisma";

export const jobCheckTick = inngest.createFunction(
  { id: "job-check-tick", triggers: [{ cron: "0 2 * * *" }] },
  async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);

    const contacts = await prisma.contact.findMany({
      where: {
        linkedinUrl: { not: "" },
        removedAt: null,
        AND: [
          { OR: [{ lastJobCheckAt: null }, { lastJobCheckAt: { lt: cutoff } }] },
          { OR: [{ currentTitle: null }, { NOT: priorityTitleWhere() }] },
        ],
      },
      select: { id: true },
      orderBy: { lastJobCheckAt: "asc" }, // oldest-first so the queue drains evenly
      take: 100,
    });

    if (contacts.length === 0) return { dispatched: 0 };

    await inngest.send(
      contacts.map((c) => ({
        name: "job.check" as const,
        data: { contactId: c.id },
      }))
    );

    return { dispatched: contacts.length };
  }
);
