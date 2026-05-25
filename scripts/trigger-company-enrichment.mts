import { prisma } from "../lib/prisma.js";
import { Inngest } from "inngest";

const inngest = new Inngest({
  id: "linkedin-sales-intelligence",
  eventKey: process.env.INNGEST_EVENT_KEY ?? "local",
  baseUrl: "http://localhost:8288",
});

const orgs = await prisma.organization.findMany({ select: { id: true } });

console.log(`Triggering company enrichment for ${orgs.length} orgs`);

for (const org of orgs) {
  await inngest.send({
    name: "companies.enrich-web",
    data: { orgId: org.id },
  });
  console.log(`  Sent for org ${org.id}`);
}

console.log("✓ Done — check Inngest dashboard at localhost:8288");
await prisma.$disconnect();
