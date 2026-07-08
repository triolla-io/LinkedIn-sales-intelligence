/**
 * One-time backfill: propagate every existing PersonEnrichment cache row to all
 * empty sibling contacts in its org.
 *
 * Background: enrichment used to update only the enriching user's contact row.
 * Other users in the same org who hold the same person kept empty rows until
 * they re-ran enrich. This replays the (now automatic) propagation over the
 * historical cache so those rows are filled once.
 *
 * Safe to run multiple times — propagateEnrichment fills only empty fields.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/backfill-shared-enrichment.ts
 */

import { prisma } from "@/lib/prisma";
import { propagateEnrichment } from "@/lib/enrichment/propagate";

async function main() {
  const caches = await prisma.personEnrichment.findMany({
    select: {
      orgId: true,
      linkedinUrlNormalized: true,
      email: true,
      phone: true,
      companySize: true,
      currentCompany: true,
      industry: true,
    },
  });

  console.log(`Found ${caches.length} PersonEnrichment rows to replay`);

  let totalFilled = 0;
  for (const cache of caches) {
    const { filled, scanned } = await propagateEnrichment({
      orgId: cache.orgId,
      linkedinUrlNormalized: cache.linkedinUrlNormalized,
      // no sourceContactId — fill every empty sibling in the org
      values: {
        email: cache.email,
        phone: cache.phone,
        companySize: cache.companySize,
        currentCompany: cache.currentCompany,
        industry: cache.industry,
      },
    });
    if (filled > 0) {
      console.log(`  ${cache.linkedinUrlNormalized}: filled ${filled}/${scanned}`);
      totalFilled += filled;
    }
  }

  console.log(`Done. Filled ${totalFilled} contact rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
