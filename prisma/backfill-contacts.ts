/**
 * Backfill Ariel's contacts: link companyId, fill industry + companySize from Company table.
 * Run: set -a && source .env && set +a && npx tsx prisma/backfill-contacts.ts
 */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";
import { slugifyCompany } from "../lib/utils/slug-utils";
import { getIndustry } from "../lib/classifier/industry";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "ariel@triolla.io" },
    select: { id: true },
  });
  const userId = user.id;
  console.log("userId:", userId);

  // Stats before
  const total = await prisma.contact.count({ where: { ownerId: userId, removedAt: null } });
  const noCompanyId = await prisma.contact.count({ where: { ownerId: userId, removedAt: null, companyId: null, currentCompany: { not: null } } });
  const noIndustry = await prisma.contact.count({ where: { ownerId: userId, removedAt: null, industry: null } });
  const noSize = await prisma.contact.count({ where: { ownerId: userId, removedAt: null, companySize: null } });
  console.log(`Before — total:${total} noCompanyId:${noCompanyId} noIndustry:${noIndustry} noSize:${noSize}`);

  // Load all contacts with a currentCompany
  const contacts = await prisma.contact.findMany({
    where: { ownerId: userId, removedAt: null, currentCompany: { not: null } },
    select: { id: true, currentCompany: true, companyId: true, industry: true, companySize: true },
  });

  // Collect unique slugs
  const slugSet = new Set<string>();
  for (const c of contacts) {
    const slug = c.currentCompany ? slugifyCompany(c.currentCompany) : "";
    if (slug) slugSet.add(slug);
  }

  // Load matching company rows
  const companyRows = await prisma.company.findMany({
    where: { universalName: { in: [...slugSet] } },
    select: { id: true, universalName: true, staffCount: true, industry: true },
  });
  const companyBySlug = new Map(companyRows.map((r) => [r.universalName, r]));

  let updated = 0;
  const CHUNK = 100;
  const toUpdate: Array<{ id: string; companyId?: string; industry?: string; companySize?: number }> = [];

  for (const c of contacts) {
    const slug = c.currentCompany ? slugifyCompany(c.currentCompany) : "";
    const company = slug ? companyBySlug.get(slug) : undefined;
    const newIndustry = (c.currentCompany && !c.industry) ? (getIndustry(c.currentCompany) || undefined) : undefined;

    const patch: Record<string, unknown> = {};
    if (company && !c.companyId) patch.companyId = company.id;
    if (company?.staffCount != null && c.companySize == null) patch.companySize = company.staffCount;
    if (newIndustry) patch.industry = newIndustry;
    // If company now has industry and contact doesn't
    if (company?.industry && !c.industry && !newIndustry) patch.industry = company.industry;

    if (Object.keys(patch).length > 0) {
      toUpdate.push({ id: c.id, ...patch as any });
    }
  }

  console.log(`Contacts needing update: ${toUpdate.length}`);

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map(({ id, ...data }) => prisma.contact.update({ where: { id }, data }))
    );
    updated += chunk.length;
    process.stdout.write(`  ${updated}/${toUpdate.length}...\r`);
  }

  // Stats after
  const noIndustryAfter = await prisma.contact.count({ where: { ownerId: userId, removedAt: null, industry: null } });
  const noSizeAfter = await prisma.contact.count({ where: { ownerId: userId, removedAt: null, companySize: null } });
  const noCompanyIdAfter = await prisma.contact.count({ where: { ownerId: userId, removedAt: null, companyId: null, currentCompany: { not: null } } });
  console.log(`\nAfter  — noCompanyId:${noCompanyIdAfter} noIndustry:${noIndustryAfter} noSize:${noSizeAfter}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
