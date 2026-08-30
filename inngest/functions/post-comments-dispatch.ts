import { inngest } from "@/inngest/client";
import { dispatchPostScrapes } from "@/lib/post-comments/dispatch";

// Kick-on-enable: when an org turns the "תגובות לפוסטים" module ON, dispatch a first batch
// of SCRAPE_POSTS tasks immediately (scoped to that org) so it starts working right away
// instead of waiting for the daily cron.
export const postCommentsDispatchOnEnable = inngest.createFunction(
  { id: "post-comments-dispatch-on-enable", triggers: [{ event: "post-comments.enabled" as const }] },
  async ({ event }) => {
    const { orgId } = event.data as { orgId: string };
    return dispatchPostScrapes({ orgId });
  }
);
