import { prisma } from "../lib/prisma";

async function main() {
  const tasks = await prisma.extensionTask.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { user: { include: { extensionSession: true } } },
  });

  if (tasks.length === 0) {
    console.log("❌ אין ExtensionTask בכלל — הsequence לא יצר task");
    console.log("\nבדיקת enrollments פעילים:");
    const enrollments = await prisma.sequenceEnrollment.findMany({
      where: { status: "ACTIVE" },
      include: { sequence: { select: { name: true } } },
      take: 5,
    });
    console.log(enrollments.map(e => ({ id: e.id, sequence: e.sequence.name, status: e.status })));
  } else {
    for (const t of tasks) {
      const session = t.user.extensionSession;
      const lastSeen = session?.lastSeenAt;
      const minsAgo = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 60000) : null;
      console.log({
        id: t.id,
        kind: t.kind,
        status: t.status,
        scheduledFor: t.scheduledFor.toISOString(),
        overdue: t.scheduledFor < new Date() ? "✅ כבר הגיע זמן" : "⏳ עדיין לא",
        claimedAt: t.claimedAt,
        errorCode: t.errorCode,
        errorMessage: t.errorMessage,
        extensionLastSeen: lastSeen ? `${minsAgo} דקות לפני` : "❌ אף פעם",
        extensionRevoked: session?.revokedAt ? "⚠️ בוטל" : "לא בוטל",
      });
    }
  }
}

main().finally(() => prisma.$disconnect());
