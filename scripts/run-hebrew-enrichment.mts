import { prisma } from "../lib/prisma.js";
import { lookupHebrew } from "../lib/enrichment/name-lookup.js";
import { translateNames, type NameInput } from "../lib/enrichment/gemini-names.js";

const BATCH = 50;
const OWNER_EMAIL = process.argv[2];

const whereOwner = OWNER_EMAIL
  ? await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } }).then(u => u?.id)
  : undefined;

const contacts = await prisma.contact.findMany({
  where: {
    ...(whereOwner ? { ownerId: whereOwner } : {}),
    removedAt: null,
    hebrewFirstName: null,
  },
  select: { id: true, fullName: true },
});

console.log(`Found ${contacts.length} contacts missing Hebrew name`);
if (contacts.length === 0) { await prisma.$disconnect(); process.exit(0); }

const nameCache: Record<string, string> = {};
let fromLookup = 0, fromGemini = 0;

for (let i = 0; i < contacts.length; i += BATCH) {
  const batch = contacts.slice(i, i + BATCH);
  const needsGemini: NameInput[] = [];

  for (const c of batch) {
    const firstName = c.fullName.trim().split(/\s+/)[0];
    const key = firstName.toLowerCase();

    const fromTable = lookupHebrew(firstName) ?? nameCache[key];
    if (fromTable) {
      await prisma.contact.update({ where: { id: c.id }, data: { hebrewFirstName: fromTable } });
      nameCache[key] = fromTable;
      fromLookup++;
      continue;
    }

    needsGemini.push({ id: c.id, firstName });
  }

  if (needsGemini.length > 0) {
    const results = await translateNames(needsGemini);
    for (const r of results) {
      if (!r.hebrewFirstName) continue;
      await prisma.contact.updateMany({ where: { id: r.id }, data: { hebrewFirstName: r.hebrewFirstName } });
      const input = needsGemini.find(n => n.id === r.id);
      if (input) nameCache[input.firstName.toLowerCase()] = r.hebrewFirstName;
      fromGemini++;
    }
  }

  process.stdout.write(`\r${Math.min(i + BATCH, contacts.length)}/${contacts.length} (lookup: ${fromLookup}, gemini: ${fromGemini})`);
}

console.log(`\n✓ Done — fromLookup: ${fromLookup}, fromGemini: ${fromGemini}`);
await prisma.$disconnect();
