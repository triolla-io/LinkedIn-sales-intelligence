import { prisma } from "@/lib/prisma";

const EMAIL = "ariel@triolla.io";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) { console.error("User not found:", EMAIL); process.exit(1); }

  const [contacts, imports, jobs] = await Promise.all([
    prisma.contact.count({ where: { ownerId: user.id } }),
    prisma.import.count({ where: { ownerId: user.id } }),
    prisma.importJob.count({ where: { ownerId: user.id } }),
  ]);
  console.log(`Found: ${contacts} contacts, ${imports} import records, ${jobs} import jobs`);

  // Delete dependents first (FK order)
  await prisma.sentMessage.deleteMany({ where: { senderId: user.id } });
  await prisma.campaignRecipient.deleteMany({ where: { contact: { ownerId: user.id } } });
  await prisma.sequenceEnrollment.deleteMany({ where: { contact: { ownerId: user.id } } });
  await prisma.contactListMember.deleteMany({ where: { contact: { ownerId: user.id } } });
  await prisma.contact.deleteMany({ where: { ownerId: user.id } });
  await prisma.import.deleteMany({ where: { ownerId: user.id } });
  await prisma.importJob.deleteMany({ where: { ownerId: user.id } });

  console.log("✓ Cleared all contacts, import history, and import jobs for", EMAIL);
}

main().finally(() => prisma.$disconnect());
