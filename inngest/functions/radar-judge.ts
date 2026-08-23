import { inngest } from "@/inngest/client";
import { judgeAndDraft } from "@/lib/tech-radar/judge-and-draft";

/**
 * Rank, veto and draft on AxisMatch rows that already exist. No search, no triage.
 *
 * Triage is ~80% of a full run's cost, and every tuning round from here changes the veto
 * or the draft rather than the search. Re-judging costs about $0.10 against ~$1, which is
 * what makes iterating on the judgement affordable at all.
 */
export const radarJudge = inngest.createFunction(
  {
    id: "radar-judge",
    name: "Relationship Radar — judge and draft existing matches",
    concurrency: { limit: 1, key: "event.data.orgId" },
    triggers: [{ event: "radar.judge" as const }],
  },
  async ({ event, step }) => {
    const { orgId } = event.data as { orgId: string };
    const report = await step.run("judge-and-draft", () => judgeAndDraft(orgId));
    console.log(`[radar] judge org=${orgId} ${JSON.stringify(report)}`);
    return report;
  }
);
