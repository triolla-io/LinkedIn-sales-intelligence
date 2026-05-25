import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const campaigns = await prisma.campaign.findMany({
    include: {
      recipients: {
        include: { contact: true },
      },
    },
  });

  console.log(`Found ${campaigns.length} old campaigns to migrate.`);

  for (const campaign of campaigns) {
    console.log(`Migrating campaign: ${campaign.name} (${campaign.id})`);

    // Check if already migrated (idempotent)
    const existing = await prisma.sequence.findFirst({
      where: { name: `[migrated] ${campaign.name}` },
    });
    if (existing) {
      console.log(`  → already migrated, skipping`);
      continue;
    }

    // Create a contact list from the recipients
    const list = await prisma.contactList.create({
      data: {
        ownerId: campaign.ownerId,
        name: `[migrated] ${campaign.name}`,
        members: {
          create: campaign.recipients.map((r: any) => ({ contactId: r.contactId })),
        },
      },
    });

    // Create the sequence
    const sequence = await prisma.sequence.create({
      data: {
        ownerId: campaign.ownerId,
        orgId: campaign.orgId,
        name: `[migrated] ${campaign.name}`,
        contactListId: list.id,
        status: campaign.status === "RUNNING"
          ? "ACTIVE"
          : campaign.status === "COMPLETED"
          ? "COMPLETED"
          : campaign.status === "CANCELLED"
          ? "CANCELLED"
          : campaign.status === "PAUSED"
          ? "PAUSED"
          : campaign.status === "QUEUED"
          ? "QUEUED"
          : "DRAFT",
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
        steps: {
          create: [
            {
              stepNumber: 1,
              dayOffset: 0,
              channel: campaign.channel,
              templateId: campaign.templateId,
              subject: campaign.subject,
              sendHour: 9,
              sendMinute: 0,
            },
          ],
        },
      },
      include: { steps: true },
    });

    const step = sequence.steps[0];

    // Create enrollments + executions for each recipient
    for (const recipient of campaign.recipients) {
      const enrollment = await prisma.sequenceEnrollment.create({
        data: {
          sequenceId: sequence.id,
          contactId: recipient.contactId,
          status: "ACTIVE",
          enrolledAt: campaign.createdAt,
        },
      });

      const execStatus =
        recipient.status === "SENT" ? "SENT"
        : recipient.status === "FAILED" ? "FAILED"
        : recipient.status === "SKIPPED" ? "SKIPPED"
        : "PENDING";

      await prisma.sequenceStepExecution.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: step.id,
          status: execStatus,
          scheduledAt: recipient.scheduledAt ?? campaign.createdAt,
          sentAt: recipient.sentAt,
          renderedBody: recipient.renderedBody,
          errorMessage: recipient.errorMessage,
          attemptCount: recipient.attemptCount,
        },
      });
    }

    console.log(`  → migrated with ${campaign.recipients.length} recipients`);
  }

  console.log("Migration complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
