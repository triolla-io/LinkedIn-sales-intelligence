import { prisma } from "../lib/prisma.js";

const total = await prisma.contact.count({ where: { removedAt: null } });
const withHebrew = await prisma.contact.count({ where: { removedAt: null, hebrewFirstName: { not: null } } });
const sample = await prisma.contact.findMany({
  where: { removedAt: null, hebrewFirstName: { not: null } },
  select: { fullName: true, hebrewFirstName: true },
  take: 5,
});

console.log(`Total contacts: ${total}`);
console.log(`With Hebrew name: ${withHebrew} (${Math.round(withHebrew / total * 100)}%)`);
console.log("Samples:", sample);
await prisma.$disconnect();
