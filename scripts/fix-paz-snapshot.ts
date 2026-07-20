/**
 * One-off cleanup for the false job-change created for Paz Romano.
 *
 * Background: Apollo returned a stale current company (Sea-Gal, a 2015 role) so
 * the job-check pipeline recorded a spurious COMPANY_MOVE and advanced his
 * snapshot to the wrong value. The pipeline bug is fixed in lib/apollo/client.ts
 * (deriveCurrentRole), but the already-poisoned row must be repaired by hand:
 *   1. delete the false ContactJobChange (PENDING_REVIEW)
 *   2. restore the snapshot to his real current role (Co-Founder / Stealth AI Startup)
 *   3. remove him from the auto-created "Job Changes" list
 *
 * Run: npx tsx --env-file=.env scripts/fix-paz-snapshot.ts
 */
import { prisma } from "@/lib/prisma";

const CONTACT_ID = "cmq9mlvfq00w5i6itynmmg729";

async function main() {
  const contact = await prisma.contact.findUnique({
    where: { id: CONTACT_ID },
    select: { ownerId: true, fullName: true },
  });
  if (!contact) throw new Error(`contact ${CONTACT_ID} not found`);

  // 1. Delete every pending/false job-change for this contact.
  const del = await prisma.contactJobChange.deleteMany({ where: { contactId: CONTACT_ID } });

  // 2. Restore the poisoned snapshot to the real current role.
  await prisma.contact.update({
    where: { id: CONTACT_ID },
    data: { jobSnapshotTitle: "Co-Founder", jobSnapshotCompany: "Stealth AI Startup" },
  });

  // 3. Remove him from the auto-created "Job Changes" list.
  const list = await prisma.contactList.findUnique({
    where: { ownerId_name: { ownerId: contact.ownerId, name: "Job Changes" } },
  });
  if (list) {
    await prisma.contactListMember.deleteMany({ where: { listId: list.id, contactId: CONTACT_ID } });
  }

  const after = await prisma.contact.findUnique({
    where: { id: CONTACT_ID },
    select: { fullName: true, hebrewFirstName: true, jobSnapshotTitle: true, jobSnapshotCompany: true },
  });
  console.log(`deleted ${del.count} false job-change(s)`);
  console.log("contact after:", JSON.stringify(after));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
