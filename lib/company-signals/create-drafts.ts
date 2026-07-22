/**
 * For a verified CompanySignal, draft one PENDING_REVIEW congratulation per C-level contact
 * at that company whose owner's org has the company-signals module enabled. Idempotent per
 * (signalId, contactId). Adds each contact to the owner's "איתותי חברה" list (same pattern as
 * the job-change "Job Changes" list). Sets the signal to DRAFTED when done.
 */
import { prisma } from "@/lib/prisma";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";
import { draftCongrats } from "@/lib/company-signals/draft";

const LIST_NAME = "חדשות חברות";

export async function createDraftsForSignal(signalId: string): Promise<{ created: number }> {
  const signal = await prisma.companySignal.findUniqueOrThrow({
    where: { id: signalId },
    select: {
      id: true, signalType: true, title: true, summary: true,
      company: { select: { id: true, name: true } },
    },
  });

  // C-level contacts at this company whose owner's org enabled the module.
  const contacts = await prisma.contact.findMany({
    where: {
      companyId: signal.company.id,
      removedAt: null,
      linkedinUrl: { not: "" },
      owner: { org: { companySignalsEnabled: true } },
      ...clevelTitleWhere(),
    },
    select: { id: true, ownerId: true, fullName: true, hebrewFirstName: true, currentTitle: true },
  });

  let created = 0;
  for (const c of contacts) {
    const exists = await prisma.companySignalDraft.findUnique({
      where: { signalId_contactId: { signalId: signal.id, contactId: c.id } },
      select: { id: true },
    });
    if (exists) continue;

    const message = await draftCongrats({
      contactFullName: c.fullName,
      hebrewFirstName: c.hebrewFirstName,
      contactTitle: c.currentTitle,
      companyName: signal.company.name,
      signalType: signal.signalType,
      signalTitle: signal.title,
      signalSummary: signal.summary,
    });

    let list;
    try {
      list = await prisma.contactList.upsert({
        where: { ownerId_name: { ownerId: c.ownerId, name: LIST_NAME } },
        create: { ownerId: c.ownerId, name: LIST_NAME },
        update: {},
      });
    } catch {
      list = await prisma.contactList.findUniqueOrThrow({
        where: { ownerId_name: { ownerId: c.ownerId, name: LIST_NAME } },
      });
    }

    // Wrap the draft-create + list-member-upsert together so a mid-write crash cannot leave a
    // PENDING_REVIEW draft that the idempotency check would then skip forever without the
    // contact ever landing on the "איתותי חברה" list. Mirrors lib/job-check/detect-change.ts.
    // (draftCongrats + the ContactList upsert stay OUTSIDE — no network/DDL inside a tx.)
    await prisma.$transaction([
      prisma.companySignalDraft.create({
        data: { signalId: signal.id, contactId: c.id, ownerId: c.ownerId, draftMessage: message, status: "PENDING_REVIEW" },
      }),
      prisma.contactListMember.upsert({
        where: { listId_contactId: { listId: list.id, contactId: c.id } },
        create: { listId: list.id, contactId: c.id },
        update: {},
      }),
    ]);
    created += 1;
  }

  await prisma.companySignal.update({ where: { id: signal.id }, data: { status: "DRAFTED" } });
  return { created };
}
