import { inngest } from "@/inngest/client";
import { createDraftsForSignal } from "@/lib/company-signals/create-drafts";

export const companySignalsDraft = inngest.createFunction(
  { id: "company-signals-draft", concurrency: 4, triggers: [{ event: "company.signals.draft" as const }] },
  async ({ event, step }) => {
    const { signalId } = event.data as { signalId: string };
    const { created } = await step.run("create-drafts", () => createDraftsForSignal(signalId));
    return { created };
  }
);
