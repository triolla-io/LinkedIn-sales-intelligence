import { inngest } from "@/inngest/client";
import { dispatchPostScrapes } from "@/lib/post-comments/dispatch";

// Daily: enqueue SCRAPE_POSTS extension tasks for watched contacts across all orgs with
// the module enabled. Actual scraping runs in the customer's extension; visits are spread
// through the day (see dispatchPostScrapes).
export const postCommentsTick = inngest.createFunction(
  { id: "post-comments-tick", name: "Post-comments dispatch (daily)", triggers: [{ cron: "0 8 * * *" }] },
  async () => dispatchPostScrapes()
);
