import { prisma } from "@/lib/prisma";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "ariel@triolla.io" }, select: { id: true } });
  if (!user) { console.log("user not found"); return; }

  const total = await prisma.contact.count({ where: { ownerId: user.id, removedAt: null } });
  const withHebrew = await prisma.contact.count({ where: { ownerId: user.id, removedAt: null, hebrewFirstName: { not: null } } });
  const withoutHebrew = await prisma.contact.count({ where: { ownerId: user.id, removedAt: null, hebrewFirstName: null } });
  console.log({ total, withHebrew, withoutHebrew });

  const sample = await prisma.contact.findMany({
    where: { ownerId: user.id, removedAt: null },
    select: { fullName: true, hebrewFirstName: true },
    take: 10,
  });
  console.log("sample:", sample);
}

main().catch(console.error).finally(() => prisma.$disconnect());
