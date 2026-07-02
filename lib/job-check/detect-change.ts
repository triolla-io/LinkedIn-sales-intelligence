import { prisma } from "@/lib/prisma";

export interface JobChangeInput {
  contactId: string;
  ownerId: string;
  snapshotTitle: string | null;
  snapshotCompany: string | null;
  freshTitle: string | null;
  freshCompany: string | null;
}

export interface JobChangeResult {
  result: "no_change" | "change_detected";
  titleChanged: boolean;
  companyChanged: boolean;
}

/**
 * Compare freshly-fetched title/company against the stored snapshot and, if either
 * changed, record a ContactJobChange, add the contact to the org's "Job Changes"
 * list, and advance the snapshot — all in one transaction. Source-agnostic: both the
 * Apollo and Bright Data pipelines call this. A field only counts as changed when the
 * fresh value is non-null and differs from the snapshot.
 */
export async function recordJobChangeIfAny(input: JobChangeInput): Promise<JobChangeResult> {
  const { contactId, ownerId, snapshotTitle, snapshotCompany, freshTitle, freshCompany } = input;

  const titleChanged = freshTitle !== null && freshTitle !== snapshotTitle;
  const companyChanged = freshCompany !== null && freshCompany !== snapshotCompany;

  if (!titleChanged && !companyChanged) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { lastJobCheckAt: new Date() },
    });
    return { result: "no_change", titleChanged: false, companyChanged: false };
  }

  let list;
  try {
    list = await prisma.contactList.upsert({
      where: { ownerId_name: { ownerId, name: "Job Changes" } },
      create: { ownerId, name: "Job Changes" },
      update: {},
    });
  } catch {
    list = await prisma.contactList.findUniqueOrThrow({
      where: { ownerId_name: { ownerId, name: "Job Changes" } },
    });
  }

  await prisma.$transaction([
    prisma.contactJobChange.create({
      data: {
        contactId,
        prevTitle: snapshotTitle,
        newTitle: titleChanged ? freshTitle : snapshotTitle,
        prevCompany: snapshotCompany,
        newCompany: companyChanged ? freshCompany : snapshotCompany,
      },
    }),
    prisma.contactListMember.upsert({
      where: { listId_contactId: { listId: list.id, contactId } },
      create: { listId: list.id, contactId },
      update: {},
    }),
    prisma.contact.update({
      where: { id: contactId },
      data: {
        jobSnapshotTitle: titleChanged ? freshTitle : snapshotTitle,
        jobSnapshotCompany: companyChanged ? freshCompany : snapshotCompany,
        lastJobCheckAt: new Date(),
      },
    }),
  ]);

  return { result: "change_detected", titleChanged, companyChanged };
}
