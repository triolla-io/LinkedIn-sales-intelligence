import { inngest } from "@/inngest/client";
import { createDraftsForOpportunity } from "@/lib/tech-radar/create-drafts";

// Prepare messages for one opportunity: pick up to 3 senior contacts per owner, then
// write one short Hebrew message each. The system prepares; the human sends.
export const techRadarDraft = inngest.createFunction(
  { id: "tech-radar-draft", name: "Tech Radar — draft", concurrency: 5, triggers: [{ event: "tech-radar.draft" as const }] },
  async ({ event, step }) => {
    const { opportunityId } = event.data as { opportunityId: string };
    const result = await step.run("draft", () => createDraftsForOpportunity(opportunityId));
    return { opportunityId, ...result };
  }
);
