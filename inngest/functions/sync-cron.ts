import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

export const syncCron = inngest.createFunction(
  { id: "sync-cron" },
  { cron: "0 * * * *" }, // every hour
  async ({ step }) => {
    const users = await step.run("find-due-users", async () => {
      const now = new Date();
      // Load all users with active LinkedIn sessions
      const sessions = await prisma.linkedinSession.findMany({
        where: { status: "ACTIVE" },
        select: {
          userId: true,
          lastValidatedAt: true,
          user: { select: { org: { select: { syncCadenceDays: true } } } },
        },
      });

      return sessions.filter((s) => {
        const cadenceMs = (s.user.org?.syncCadenceDays ?? 3) * 86_400_000;
        const lastSync = s.lastValidatedAt ?? new Date(0);
        return now.getTime() - lastSync.getTime() >= cadenceMs;
      });
    });

    if (users.length === 0) return { dispatched: 0 };

    await step.sendEvent(
      "dispatch-delta-syncs",
      users.map((u) => ({ name: "sync.delta", data: { userId: u.userId } }))
    );

    return { dispatched: users.length };
  }
);
