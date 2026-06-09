import { prisma } from "../lib/prisma";

async function main() {
  const tasks = await prisma.extensionTask.findMany({
    where: { kind: "SEND" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { user: { select: { email: true } } },
  });

  if (tasks.length === 0) {
    console.log("אין SEND tasks בכלל");
    return;
  }

  for (const t of tasks) {
    console.log({
      user: t.user.email,
      status: t.status,
      scheduledFor: t.scheduledFor.toISOString(),
      overdue: t.scheduledFor < new Date() ? "✅ כבר הגיע זמן" : "⏳ עדיין לא",
      errorCode: t.errorCode,
      errorMessage: t.errorMessage,
      claimedAt: t.claimedAt,
      completedAt: t.completedAt,
    });
  }
}

main().finally(() => prisma.$disconnect());
