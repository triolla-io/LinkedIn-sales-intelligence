import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchPerson } from "@/lib/apollo/client";
import { recordJobChangeIfAny } from "@/lib/job-check/detect-change";

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
      ((fresh.raw as Record<string, unknown> | null)?.["title"] as string) ?? null;
    const freshCompany = fresh.currentCompany ?? null;

    return await step.run("detect-and-record", () =>
      recordJobChangeIfAny({
        contactId,
        ownerId: contact.ownerId,
        snapshotTitle: contact.jobSnapshotTitle,
        snapshotCompany: contact.jobSnapshotCompany,
        freshTitle,
        freshCompany,
      })
    );
  }
);
