import { inngest } from "@/inngest/client";
import { createDraftsForOpportunity } from "@/lib/tech-radar/create-drafts";

// Prepare messages for one opportunity: pick up to 3 senior contacts per owner, then
// write one short Hebrew message each. The system prepares; the human sends.
//
// concurrency 1, deliberately. The per-contact cap is a count-then-insert, so running
// five of these in parallel let three of them each read "1 existing" and all insert —
// every Delek executive received 3 messages against a cap of 2 in the first human-run
// scan. Serialising is the honest fix: the weekly cap bounds this to ~15 runs, and each
// is a handful of LLM calls, so there is nothing to gain from parallelism here.
export const techRadarDraft = inngest.createFunction(
  { id: "tech-radar-draft", name: "Tech Radar — draft", concurrency: 1, triggers: [{ event: "tech-radar.draft" as const }] },
  async ({ event, step }) => {
    const { opportunityId } = event.data as { opportunityId: string };
    const result = await step.run("draft", () => createDraftsForOpportunity(opportunityId));
    return { opportunityId, ...result };
  }
);
