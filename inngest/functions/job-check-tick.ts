import { inngest } from "@/inngest/client";
import { dispatchJobChecks } from "@/lib/job-check/dispatch";

// Nightly: enqueue SCRAPE_PROFILE extension tasks for contacts due a job-change check,
// across all orgs with the module enabled. Actual scraping runs in the customer's
// extension; visits are spread through the day (see dispatchJobChecks).
export const jobCheckTick = inngest.createFunction(
  { id: "job-check-tick", name: "Job-change dispatch (daily)", triggers: [{ cron: "0 2 * * *" }] },
  async () => {
    const dispatched = await dispatchJobChecks();
    return { dispatched };
  }
);
