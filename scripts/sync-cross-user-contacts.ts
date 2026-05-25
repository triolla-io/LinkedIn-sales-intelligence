/**
 * Sync enrichment data across users who share the same contact (same linkedinUrn, same org).
 *
 * Fields propagated: hebrewFirstName, email, phone
 * Logic: for each linkedinUrn in an org, if any user's copy has a value, copy it to
 *        all other users' copies that are missing it (never overwrite existing data).
 *
 * Run: npx tsx scripts/sync-cross-user-contacts.ts
 */

import { prisma } from "@/lib/prisma";

async function main() {
  // Load all orgs
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Found ${orgs.length} orgs`);

  let totalUpdated = 0;

  for (const org of orgs) {
    // Get all non-removed contacts in this org with their enrichment fields
    const contacts = await prisma.contact.findMany({
      where: { owner: { orgId: org.id }, removedAt: null },
      select: {
        id: true,
        linkedinUrn: true,
        hebrewFirstName: true,
        email: true,
        phone: true,
        manualFields: true,
      },
    });

    // Group by linkedinUrn
    const byUrn = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const group = byUrn.get(c.linkedinUrn) ?? [];
      group.push(c);
      byUrn.set(c.linkedinUrn, group);
    }

    // Only process URNs with multiple users
    const overlapping = [...byUrn.values()].filter((g) => g.length > 1);
    console.log(`  Org ${org.name}: ${contacts.length} contacts, ${overlapping.length} overlapping URNs`);

    for (const group of overlapping) {
      // Find the best value for each field across the group
      const bestHebrew = group.find((c) => c.hebrewFirstName)?.hebrewFirstName ?? null;
      const bestEmail  = group.find((c) => c.email)?.email ?? null;
      const bestPhone  = group.find((c) => c.phone)?.phone ?? null;

      for (const contact of group) {
        const manual = new Set(contact.manualFields as string[]);
        const patch: Record<string, unknown> = {};

        if (bestHebrew && !contact.hebrewFirstName) patch.hebrewFirstName = bestHebrew;
        if (bestEmail  && !contact.email  && !manual.has("email"))  patch.email  = bestEmail;
        if (bestPhone  && !contact.phone  && !manual.has("phone"))  patch.phone  = bestPhone;

        if (Object.keys(patch).length === 0) continue;

        await prisma.contact.update({ where: { id: contact.id }, data: patch });
        totalUpdated++;
      }
    }
  }

  console.log(`\nDone — updated ${totalUpdated} contacts`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
