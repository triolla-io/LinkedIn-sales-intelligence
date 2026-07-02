// inngest/functions/brightdata-job-check-collect.ts
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { getSnapshotStatus, getSnapshotResults } from "@/lib/brightdata/client";
import { recordJobChangeIfAny } from "@/lib/job-check/detect-change";
import { normalizeLinkedinUrl } from "@/lib/enrichment/enrich-contact-core";

interface CollectPayload {
  ownerId: string;
  snapshotId: string;
  contacts: Array<{
    id: string;
    linkedinUrl: string;
    jobSnapshotTitle: string | null;
    jobSnapshotCompany: string | null;
  }>;
}

export const brightdataJobCheckCollect = inngest.createFunction(
  { id: "brightdata-job-check-collect", triggers: [{ event: "brightdata.job-check.collect" as const }] },
  async ({ event, step }) => {
    const { ownerId, snapshotId, contacts } = event.data as CollectPayload;

    // Poll until the snapshot is ready (async batch job on Bright Data's side).
    let status: "running" | "ready" | "failed" = "running";
    for (let attempt = 0; attempt < 20; attempt++) {
      status = await step.run(`status-${attempt}`, () => getSnapshotStatus(snapshotId));
      if (status !== "running") break;
      await step.sleep(`wait-${attempt}`, "2m");
    }
    if (status !== "ready") return { ownerId, snapshotId, status, processed: 0 };

    const rows = await step.run("download", () => getSnapshotResults(snapshotId));
    const byUrl = new Map(
      rows
        .map((r) => [normalizeLinkedinUrl(r.input_url), r] as const)
        .filter(([k]) => k !== "")
    );

    let changes = 0;
    for (const c of contacts) {
      const key = normalizeLinkedinUrl(c.linkedinUrl);
      const row = key ? byUrl.get(key) : undefined;
      const firstRun = c.jobSnapshotTitle === null && c.jobSnapshotCompany === null;

      if (!row || row.error) {
        await step.run(`mark-${c.id}`, () =>
          prisma.contact.update({ where: { id: c.id }, data: { lastJobCheckAt: new Date() } })
        );
        continue;
      }

      if (firstRun) {
        await step.run(`baseline-${c.id}`, () =>
          prisma.contact.update({
            where: { id: c.id },
            data: {
              jobSnapshotTitle: row.position ?? c.jobSnapshotTitle,
              jobSnapshotCompany: row.current_company_name ?? c.jobSnapshotCompany,
              lastJobCheckAt: new Date(),
            },
          })
        );
        continue;
      }

      const res = await step.run(`detect-${c.id}`, () =>
        recordJobChangeIfAny({
          contactId: c.id,
          ownerId,
          snapshotTitle: c.jobSnapshotTitle,
          snapshotCompany: c.jobSnapshotCompany,
          freshTitle: row.position,
          freshCompany: row.current_company_name,
        })
      );
      if (res.result === "change_detected") changes++;
    }

    return { ownerId, snapshotId, status, processed: contacts.length, changes };
  }
);
