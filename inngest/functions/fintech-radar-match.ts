import { inngest } from "@/inngest/client";
import { createMatchesForOrgArticle } from "@/lib/fintech-radar/create-matches";

export const fintechRadarMatch = inngest.createFunction(
  { id: "fintech-radar-match", name: "Fintech Radar — match", concurrency: 3, triggers: [{ event: "fintech.radar.match" as const }] },
  async ({ event, step }) => {
    const { orgId, articleId } = event.data as { orgId: string; articleId: string };
    const { matchIds } = await step.run("create-matches", () => createMatchesForOrgArticle(orgId, articleId));
    if (matchIds.length > 0) {
      await step.sendEvent("dispatch-draft", matchIds.map((id) => ({ name: "fintech.radar.draft" as const, data: { matchId: id } })));
    }
    return { drafts: matchIds.length };
  }
);
