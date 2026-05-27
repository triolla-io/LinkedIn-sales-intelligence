import { prisma } from "@/lib/prisma";
import { buildContacts, shouldSkipSeed } from "@/scripts/seed-helpers";
import type { CampaignChannel, RecipientStatus } from "@/lib/generated/prisma/client";

const SEED_USER_EMAIL = "ariel@triolla.io";

const PERSONA_USERS = [
  { name: "Daniel Shalem", email: "daniel@triolla.io" },
  { name: "Yuval Bar-Or", email: "yuval@triolla.io" },
  { name: "Adi Berman", email: "adi@triolla.io" },
];

const TEMPLATES = [
  {
    name: "LinkedIn Intro",
    body: "Hey {{firstName}}, saw your work at {{company}} — really interesting stuff. Would love to connect and share thoughts on {{industry}}. What do you think?",
  },
  {
    name: "WhatsApp Warm",
    body: "היי {{hebrewFirstName}} 👋\nראיתי שאתה ב-{{company}} — נשמע מעניין.\nיש לי משהו שיכול להיות רלוונטי לתפקיד שלך. 5 דקות?",
  },
  {
    name: "Email Cold",
    body: "Hi {{firstName}},\n\nI came across your profile and noticed your work at {{company}}.\n\nI'd love to share something relevant to {{title}} — it's helped similar teams reduce [pain point] by 30%.\n\nWorth a quick call?\n\nBest,\nAriel",
  },
];

async function main() {
  const force = process.argv.includes("--force");

  // 1. Find seed user
  const devUser = await prisma.user.findUnique({
    where: { email: SEED_USER_EMAIL },
    include: { org: true },
  });

  if (!devUser) {
    console.error(`\n❌  ${SEED_USER_EMAIL} not found in database.`);
    console.error(`    Sign in with Google as ${SEED_USER_EMAIL} first, then re-run this script.\n`);
    process.exit(1);
  }

  const orgId = devUser.orgId;

  // 2. Idempotency check
  const existingCount = await prisma.contact.count({ where: { ownerId: devUser.id } });
  if (shouldSkipSeed(existingCount, force)) {
    console.log(`✓ Already seeded (${existingCount} contacts). Use --force to re-seed.`);
    process.exit(0);
  }

  console.log(`🌱 Seeding ${SEED_USER_EMAIL} org...`);

  // 3. Upgrade seed user to ADMIN
  await prisma.user.update({
    where: { id: devUser.id },
    data: { role: "ADMIN" },
  });
  console.log(`  ✓ ${SEED_USER_EMAIL} upgraded to ADMIN`);

  // 4. Create persona users in the same org
  const personas: Array<{ id: string; name: string; email: string }> = [];
  for (const p of PERSONA_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: p.email } });
    if (existing) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: { orgId },
      });
      personas.push({ id: updated.id, name: updated.name, email: updated.email });
    } else {
      const created = await prisma.user.create({
        data: { email: p.email, name: p.name, orgId, role: "SALESPERSON" },
      });
      personas.push({ id: created.id, name: created.name, email: created.email });
    }
  }
  console.log(`  ✓ ${personas.length} persona users ready`);

  // 5. Seed contacts owned by devUser
  const contactData = buildContacts(devUser.id);
  for (const c of contactData) {
    await prisma.contact.upsert({
      where: { ownerId_linkedinUrn: { ownerId: c.ownerId, linkedinUrn: c.linkedinUrn } },
      create: c,
      update: c,
    });
  }
  const allContacts = await prisma.contact.findMany({ where: { ownerId: devUser.id }, select: { id: true } });
  console.log(`  ✓ ${allContacts.length} contacts seeded`);

  // 6. Create templates
  const createdTemplates: Array<{ id: string; name: string }> = [];
  for (const t of TEMPLATES) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { ownerId: devUser.id, name: t.name },
    });
    if (existing) {
      createdTemplates.push(existing);
    } else {
      const created = await prisma.messageTemplate.create({
        data: { ownerId: devUser.id, name: t.name, body: t.body },
      });
      createdTemplates.push(created);
    }
  }
  console.log(`  ✓ ${createdTemplates.length} templates seeded`);

  // 7. Create contact list
  const listName = "Seed List";
  let contactList = await prisma.contactList.findFirst({
    where: { ownerId: devUser.id, name: listName },
  });
  if (!contactList) {
    contactList = await prisma.contactList.create({
      data: { ownerId: devUser.id, name: listName },
    });
  }
  for (const c of allContacts) {
    await prisma.contactListMember.upsert({
      where: { listId_contactId: { listId: contactList.id, contactId: c.id } },
      create: { listId: contactList.id, contactId: c.id },
      update: {},
    });
  }
  console.log(`  ✓ Contact list "${listName}" with ${allContacts.length} members`);

  // 8. Create a completed LinkedIn campaign
  const linkedinTemplate = createdTemplates.find((t) => t.name === "LinkedIn Intro")!;
  const existingCampaign = await prisma.campaign.findFirst({
    where: { ownerId: devUser.id, name: "Seed Campaign — LinkedIn Intro" },
  });
  if (!existingCampaign) {
    const campaign = await prisma.campaign.create({
      data: {
        ownerId: devUser.id,
        name: "Seed Campaign — LinkedIn Intro",
        channel: "LINKEDIN" as CampaignChannel,
        templateId: linkedinTemplate.id,
        status: "COMPLETED",
        startedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      },
    });
    const campaignContacts = allContacts.slice(0, 20);
    const statuses: RecipientStatus[] = ["SENT","SENT","SENT","SENT","SENT","FAILED","SKIPPED","SENT","SENT","SENT","SENT","FAILED","SENT","SENT","SKIPPED","SENT","SENT","SENT","FAILED","SENT"];
    for (let i = 0; i < campaignContacts.length; i++) {
      await prisma.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          contactId: campaignContacts[i].id,
          status: statuses[i],
          renderedBody: "Hey there, saw your work — would love to connect!",
          sentAt: statuses[i] === "SENT" ? new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) : null,
        },
      });
    }
    console.log("  ✓ Completed LinkedIn campaign seeded (20 recipients)");
  }

  // 9. Create an active sequence
  const existingSequence = await prisma.sequence.findFirst({
    where: { ownerId: devUser.id, name: "Seed Sequence — 3-Step Outreach" },
  });
  if (!existingSequence) {
    const waTemplate = createdTemplates.find((t) => t.name === "WhatsApp Warm")!;
    const emailTemplate = createdTemplates.find((t) => t.name === "Email Cold")!;

    const sequence = await prisma.sequence.create({
      data: {
        ownerId: devUser.id,
        name: "Seed Sequence — 3-Step Outreach",
        contactListId: contactList.id,
        status: "ACTIVE",
        startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    const step1 = await prisma.sequenceStep.create({
      data: { sequenceId: sequence.id, stepNumber: 1, dayOffset: 0, sendHour: 9, sendMinute: 0, channel: "LINKEDIN" as CampaignChannel, templateId: linkedinTemplate.id },
    });
    const step2 = await prisma.sequenceStep.create({
      data: { sequenceId: sequence.id, stepNumber: 2, dayOffset: 3, sendHour: 10, sendMinute: 0, channel: "WHATSAPP" as CampaignChannel, templateId: waTemplate.id },
    });
    await prisma.sequenceStep.create({
      data: { sequenceId: sequence.id, stepNumber: 3, dayOffset: 7, sendHour: 9, sendMinute: 30, channel: "EMAIL" as CampaignChannel, templateId: emailTemplate.id, subject: "Quick follow-up re: {{company}}" },
    });

    const sequenceContacts = allContacts.slice(0, 10);
    for (let i = 0; i < sequenceContacts.length; i++) {
      const enrollment = await prisma.sequenceEnrollment.create({
        data: {
          sequenceId: sequence.id,
          contactId: sequenceContacts[i].id,
          status: "ACTIVE",
          enrolledAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.sequenceStepExecution.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: step1.id,
          status: i < 7 ? "SENT" : "PENDING",
          scheduledAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          sentAt: i < 7 ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) : null,
          renderedBody: "Hey, saw your work — would love to connect!",
        },
      });

      await prisma.sequenceStepExecution.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: step2.id,
          status: "PENDING",
          scheduledAt: new Date(Date.now() + (i < 7 ? 0 : 3) * 24 * 60 * 60 * 1000),
        },
      });
    }
    console.log("  ✓ Active 3-step sequence seeded (10 enrollments)");
  }

  console.log(`\n✅ Seed complete! Signed in as ${SEED_USER_EMAIL} (ADMIN) with sample contacts, templates, campaign, and sequence.\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
