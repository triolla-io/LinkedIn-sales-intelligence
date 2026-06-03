import { prisma } from "../lib/prisma.js";
import * as readline from "readline";

const TARGET_EMAIL = process.env.TARGET_EMAIL ?? "ariel@triolla.io";

const user = await prisma.user.findUnique({
  where: { email: TARGET_EMAIL },
  select: { id: true, email: true, name: true },
});

if (!user) {
  console.error(`User not found: ${TARGET_EMAIL}`);
  process.exit(1);
}

const count = await prisma.contact.count({ where: { ownerId: user.id } });

console.log(`User: ${user.name ?? "(no name)"} <${user.email}>`);
console.log(`Contacts to delete: ${count.toLocaleString()}`);

if (count === 0) {
  console.log("Nothing to delete.");
  await prisma.$disconnect();
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise<string>((resolve) =>
  rl.question(`\nType "DELETE" to permanently delete all ${count.toLocaleString()} contacts: `, resolve)
);
rl.close();

if (answer.trim() !== "DELETE") {
  console.log("Aborted.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("Deleting...");

// Delete in batches to avoid long-running transactions
let deleted = 0;
while (true) {
  const ids = await prisma.contact.findMany({
    where: { ownerId: user.id },
    select: { id: true },
    take: 500,
  });
  if (ids.length === 0) break;
  const { count: batchCount } = await prisma.contact.deleteMany({
    where: { id: { in: ids.map((c) => c.id) } },
  });
  deleted += batchCount;
  process.stdout.write(`\rDeleted ${deleted.toLocaleString()} / ${count.toLocaleString()}...`);
}

console.log(`\nDone. Deleted ${deleted.toLocaleString()} contacts for ${user.email}.`);
await prisma.$disconnect();
