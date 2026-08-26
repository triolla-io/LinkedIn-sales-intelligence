import { inngest } from "@/inngest/client";
import { openScanRun, personScan } from "@/lib/tech-radar/person-scan";

/**
 * The person-outward run. Starts from the axes people subscribe to, so a company with
 * nobody subscribed contributes nothing.
 *
 * Not on a cron. The pilot ascends by hand: a human fires this, reads the drafts, and
 * only then is a schedule worth arguing about.
 */
export const techRadarPersonScan = inngest.createFunction(
  {
    id: "tech-radar-person-scan",
    name: "Relationship Radar — person-outward scan",
    // Serialised per org: two concurrent runs would judge the same (axis, item) pairs
    // twice and race on the AxisMatch unique index.
    concurrency: { limit: 1, key: "event.data.orgId" },
    triggers: [{ event: "radar.person-scan" as const }],
  },
  async ({ event, step }) => {
    const { orgId } = event.data as { orgId: string };
    // 2026-08-26 incident: one approved person-scan became FOUR full executions —
    // 07:43, 07:46, 07:48, 07:51, each a fresh RadarScanRun row and a fresh 39-query
    // fetch — because the old code opened its run row and did all its work inside one
    // step, and an Inngest step failure/timeout retried the whole thing from scratch.
    // 156 provider calls got spent on 39 queries' worth of work.
    //
    // The fix is this row opening in its OWN step, before the scan step runs.
    // step.run() memoizes: Inngest replays a completed step's result from history on
    // retry rather than re-invoking its callback, so "open-run" executes exactly once
    // per scan no matter how many times "person-scan" itself is retried, and every
    // attempt — original or retried — is handed the SAME run id below. Collapsing this
    // back into a single step would silently reopen the 2026-08-26 hole: do not
    // "simplify" it.
    const run = await step.run("open-run", () => openScanRun(orgId));
    const report = await step.run("person-scan", () => personScan(orgId, { runId: run.id }));
    console.log(`[radar] person-scan org=${orgId} ${JSON.stringify(report)}`);
    return report;
  }
);
