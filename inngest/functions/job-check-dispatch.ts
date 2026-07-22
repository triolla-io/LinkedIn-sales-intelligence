import { inngest } from "@/inngest/client";
import { dispatchJobChecks } from "@/lib/job-check/dispatch";

// Kick-on-enable: when an org turns the "Job Changes" module ON, dispatch a first batch
// of SCRAPE_PROFILE tasks immediately (scoped to that org) so it starts working right away
// instead of waiting for the nightly cron.
export const jobCheckDispatchOnEnable = inngest.createFunction(
  { id: "job-check-dispatch-on-enable", triggers: [{ event: "job-check.enabled" as const }] },
  async ({ event }) => {
    const { orgId } = event.data as { orgId: string };
    const dispatched = await dispatchJobChecks({ orgId });
    return { orgId, dispatched };
  }
);
