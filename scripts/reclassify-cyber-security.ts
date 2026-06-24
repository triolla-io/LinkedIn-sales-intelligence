/**
 * Reclassify rows that the industry classifier now buckets as "Cyber Security"
 * but were previously stored as "SaaS" (cyber/security keywords used to live in
 * the SaaS bucket). Only touches rows whose stored industry is exactly "SaaS"
 * AND whose company name now classifies as "Cyber Security" — Apollo/Voyager
 * sourced industries and every other bucket are left untouched.
 *
 * Dry run (default):  set -a && source .env && set +a && npx tsx scripts/reclassify-cyber-security.ts
 * Apply:              ... npx tsx scripts/reclassify-cyber-security.ts --apply
 */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";
import { getIndustry } from "../lib/classifier/industry";

const APPLY = process.argv.includes("--apply");
const TARGET = "Cyber Security";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (pass --apply to write)");

  // ── Contacts ──────────────────────────────────────────────────────────────
  const contacts = await prisma.contact.findMany({
    where: { industry: "SaaS", currentCompany: { not: null }, removedAt: null },
    select: { id: true, currentCompany: true },
  });
  const contactIds = contacts
    .filter((c) => getIndustry(c.currentCompany ?? "") === TARGET)
    .map((c) => c.id);
  console.log(`Contacts: ${contactIds.length} of ${contacts.length} SaaS-with-company → ${TARGET}`);

  // ── Companies ───────────────────────────────────────────────────────────────
  const companies = await prisma.company.findMany({
    where: { industry: "SaaS" },
    select: { id: true, name: true },
  });
  const companyIds = companies
    .filter((c) => getIndustry(c.name ?? "") === TARGET)
    .map((c) => c.id);
  console.log(`Companies: ${companyIds.length} of ${companies.length} SaaS → ${TARGET}`);

  // ── PersonEnrichment cache ──────────────────────────────────────────────────
  const enrichments = await prisma.personEnrichment.findMany({
    where: { industry: "SaaS", currentCompany: { not: null } },
    select: { id: true, currentCompany: true },
  });
  const enrichmentIds = enrichments
    .filter((e) => getIndustry(e.currentCompany ?? "") === TARGET)
    .map((e) => e.id);
  console.log(`PersonEnrichment: ${enrichmentIds.length} of ${enrichments.length} SaaS-with-company → ${TARGET}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write the changes.");
    return;
  }

  const c1 = await prisma.contact.updateMany({ where: { id: { in: contactIds } }, data: { industry: TARGET } });
  const c2 = await prisma.company.updateMany({ where: { id: { in: companyIds } }, data: { industry: TARGET } });
  const c3 = await prisma.personEnrichment.updateMany({ where: { id: { in: enrichmentIds } }, data: { industry: TARGET } });
  console.log(`\nUpdated — contacts:${c1.count} companies:${c2.count} enrichments:${c3.count}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
