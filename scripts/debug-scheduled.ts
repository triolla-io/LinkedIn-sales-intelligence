import { prisma } from "../lib/prisma";

const now = new Date();

function fmt(d: Date) {
  const diff = Math.round((d.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(diff);
  const sign = diff < 0 ? "לפני" : "עוד";
  const label =
    abs < 60 ? `${abs} דק'` : abs < 1440 ? `${Math.round(abs / 60)} שע'` : `${Math.round(abs / 1440)} ימים`;
  const status = diff < 0 ? "⏰ עבר" : "🕐 עתידי";
  return `${status} (${sign} ${label}) — ${d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}`;
}

async function main() {
  // ── 1. Sequence step executions (all channels) ──────────────────────────
  const executions = await prisma.sequenceStepExecution.findMany({
    where: { status: "PENDING" },
    orderBy: { scheduledAt: "asc" },
    take: 50,
    include: {
      enrollment: {
        include: {
          contact: { select: { fullName: true } },
          sequence: { select: { name: true } },
        },
      },
      step: { select: { channel: true, stepNumber: true } },
    },
  });

  console.log(`\n═══ SequenceStepExecution ממתינים: ${executions.length} ═══`);
  if (executions.length === 0) {
    console.log("  אין");
  } else {
    for (const e of executions) {
      console.log(
        `  [${e.step.channel.padEnd(9)}] שלב ${e.step.stepNumber} · ${e.enrollment.contact.fullName ?? "—"} · ${e.enrollment.sequence.name}\n` +
        `           ${fmt(e.scheduledAt)}`
      );
    }
  }

  // ── 2. ExtensionTask pending (LinkedIn) ──────────────────────────────────
  const tasks = await prisma.extensionTask.findMany({
    where: { status: "PENDING" },
    orderBy: { scheduledFor: "asc" },
    take: 30,
    include: { user: { select: { email: true } } },
  });

  console.log(`\n═══ ExtensionTask (LinkedIn) ממתינים: ${tasks.length} ═══`);
  if (tasks.length === 0) {
    console.log("  אין");
  } else {
    for (const t of tasks) {
      console.log(
        `  [${t.kind.padEnd(12)}] ${t.user.email}\n` +
        `           ${fmt(t.scheduledFor)}`
      );
    }
  }

  // ── 3. Summary ────────────────────────────────────────────────────────────
  const nextExec = executions[0];
  const nextTask = tasks[0];
  const nextAny = [nextExec?.scheduledAt, nextTask?.scheduledFor]
    .filter(Boolean)
    .sort((a, b) => a!.getTime() - b!.getTime())[0];

  if (nextAny) {
    console.log(`\n✅ ההודעה הבאה: ${fmt(nextAny)}`);
  } else {
    console.log("\n✅ אין הודעות מתוכננות כרגע");
  }
}

main().finally(() => prisma.$disconnect());
