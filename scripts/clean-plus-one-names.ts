import { prisma } from "@/lib/prisma";
import { cleanScrapedName } from "@/lib/prospecting/filter";

/**
 * Backfill: strip the LinkedIn "+N" badge artifact (e.g. "+1 Yuval Bar Or") from names that
 * were scraped before the scrape-time/persist-time fix landed. Affects ConnectionRequest.fullName
 * and Contact.fullName.
 *
 * Dry-run by default; pass --apply to write changes.
 *   tsx scripts/clean-plus-one-names.ts          # preview
 *   tsx scripts/clean-plus-one-names.ts --apply   # update
 */
const APPLY = process.argv.includes("--apply");
const PLUS_N = /\+\d+/;

async function main() {
  const [requests, contacts] = await Promise.all([
    prisma.connectionRequest.findMany({
      where: { fullName: { contains: "+" } },
      select: { id: true, fullName: true },
    }),
    prisma.contact.findMany({
      where: { fullName: { contains: "+" } },
      select: { id: true, fullName: true },
    }),
  ]);

  const dirtyReqs = requests.filter((r) => PLUS_N.test(r.fullName));
  const dirtyContacts = contacts.filter((c) => PLUS_N.test(c.fullName));

  console.log(`ConnectionRequest: ${dirtyReqs.length} rows with a "+N" name`);
  console.log(`Contact:           ${dirtyContacts.length} rows with a "+N" name`);
  for (const r of [...dirtyReqs, ...dirtyContacts]) {
    console.log(`  ${JSON.stringify(r.fullName)} -> ${JSON.stringify(cleanScrapedName(r.fullName))}`);
  }

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to write these changes.");
    return;
  }

  for (const r of dirtyReqs) {
    await prisma.connectionRequest.update({ where: { id: r.id }, data: { fullName: cleanScrapedName(r.fullName) } });
  }
  for (const c of dirtyContacts) {
    await prisma.contact.update({ where: { id: c.id }, data: { fullName: cleanScrapedName(c.fullName) } });
  }
  console.log(`\n✓ Updated ${dirtyReqs.length + dirtyContacts.length} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
