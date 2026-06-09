import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchPerson } from "@/lib/apollo/client";

export const jobCheckContact = inngest.createFunction(
  { id: "job-check-contact", triggers: [{ event: "job.check" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { contactId } = event.data as { contactId: string };

    const contact = await step.run("load-contact", () =>
      prisma.contact.findUniqueOrThrow({
        where: { id: contactId },
        select: {
          id: true,
          ownerId: true,
          fullName: true,
          linkedinUrl: true,
          jobSnapshotTitle: true,
          jobSnapshotCompany: true,
          currentTitle: true,
          currentCompany: true,
        },
      })
    );

    // First run: no snapshot yet — save current enrichment values as baseline.
    if (contact.jobSnapshotTitle === null && contact.jobSnapshotCompany === null) {
      await step.run("save-initial-snapshot", () =>
        prisma.contact.update({
          where: { id: contactId },
          data: {
            jobSnapshotTitle: contact.currentTitle,
            jobSnapshotCompany: contact.currentCompany,
            lastJobCheckAt: new Date(),
          },
        })
      );
      return { result: "snapshot_initialized" };
    }

    // Re-query Apollo for fresh data.
    const fresh = await step.run("fetch-fresh-data", async () => {
      try {
        return await matchPerson({
          name: contact.fullName,
          linkedinUrl: contact.linkedinUrl ?? undefined,
        });
      } catch {
        return null;
      }
    });

    if (!fresh) {
      await step.run("mark-checked", () =>
        prisma.contact.update({
          where: { id: contactId },
          data: { lastJobCheckAt: new Date() },
        })
      );
      return { result: "apollo_no_data" };
    }

    // Apollo returns raw title at raw.title; company is a named field.
    const freshTitle =
      ((fresh.raw as Record<string, unknown> | null)?.["title"] as string) ??
      null;
    const freshCompany = fresh.currentCompany ?? null;

    const titleChanged =
      freshTitle !== null && freshTitle !== contact.jobSnapshotTitle;
    const companyChanged =
      freshCompany !== null && freshCompany !== contact.jobSnapshotCompany;

    if (!titleChanged && !companyChanged) {
      await step.run("mark-checked-no-change", () =>
        prisma.contact.update({
          where: { id: contactId },
          data: { lastJobCheckAt: new Date() },
        })
      );
      return { result: "no_change" };
    }

    // Change detected: log, add to list, update snapshot — all in one DB transaction.
    await step.run("record-change", async () => {
      let list;
      try {
        list = await prisma.contactList.upsert({
          where: { ownerId_name: { ownerId: contact.ownerId, name: "Job Changes" } },
          create: { ownerId: contact.ownerId, name: "Job Changes" },
          update: {},
        });
      } catch {
        // Race: another concurrent job.check created the list — look it up directly
        list = await prisma.contactList.findUniqueOrThrow({
          where: { ownerId_name: { ownerId: contact.ownerId, name: "Job Changes" } },
        });
      }

      await prisma.$transaction([
        prisma.contactJobChange.create({
          data: {
            contactId,
            prevTitle: contact.jobSnapshotTitle,
            newTitle: titleChanged ? freshTitle : contact.jobSnapshotTitle,
            prevCompany: contact.jobSnapshotCompany,
            newCompany: companyChanged ? freshCompany : contact.jobSnapshotCompany,
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
            jobSnapshotTitle: titleChanged ? freshTitle : contact.jobSnapshotTitle,
            jobSnapshotCompany: companyChanged
              ? freshCompany
              : contact.jobSnapshotCompany,
            lastJobCheckAt: new Date(),
          },
        }),
      ]);
    });

    return { result: "change_detected", titleChanged, companyChanged };
  }
);
