import { prisma } from "../lib/prisma.js";
import { Inngest } from "inngest";

const inngest = new Inngest({
  id: "linkedin-sales-intelligence",
  eventKey: process.env.INNGEST_EVENT_KEY ?? "local",
  baseUrl: "http://localhost:8288",
});

const users = await prisma.user.findMany({
  select: { id: true, email: true, name: true, _count: { select: { contacts: true } } },
});

console.log("Triggering Haiku enrichment for:");
for (const u of users) {
  console.log(`  ${u.email} (${u._count.contacts} contacts)`);
  await inngest.send({
    name: "contacts.enrich-haiku",
    data: { ownerId: u.id },
  });
}

console.log("✓ Done — check Inngest dashboard at localhost:8288");
await prisma.$disconnect();
