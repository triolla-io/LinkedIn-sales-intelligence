import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  // Find all PENDING ExtensionTasks of kind SEND that are linked to a sequence execution
  const tasks = await prisma.extensionTask.findMany({
    where: { kind: "SEND", status: "PENDING", sequenceExecutionId: { not: null } },
  });

  const emptyText = tasks.filter((t: typeof tasks[number]) => {
    const p = t.payload as { text?: string };
    return !p.text;
  });

  console.log(`Found ${tasks.length} pending SEND tasks, ${emptyText.length} with empty text`);

  // Also pick up any future-scheduled tasks (scheduledFor > now) regardless of text
  const futureScheduled = tasks.filter(
    (t: typeof tasks[number]) => t.scheduledFor > new Date() && !emptyText.find((e: typeof tasks[number]) => e.id === t.id)
  );
  console.log(`${futureScheduled.length} additional tasks scheduled in the future`);

  const toReset = [...emptyText, ...futureScheduled];

  for (const task of toReset) {
    const execId = task.sequenceExecutionId!;
    await prisma.sequenceStepExecution.update({
      where: { id: execId },
      data: { status: "PENDING" },
    });
    await prisma.extensionTask.delete({ where: { id: task.id } });
    console.log(`✓ reset execution ${execId} → PENDING, deleted task ${task.id} (scheduledFor: ${task.scheduledFor.toISOString()})`);
  }

  if (toReset.length === 0) {
    console.log("Nothing to reset.");
  } else {
    console.log(`\nDone. Sequence-tick will re-dispatch ${toReset.length} execution(s) within 5 minutes.`);
  }
}

main().catch(console.error).finally(() => pool.end());
