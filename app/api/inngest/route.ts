import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { syncFull } from "@/inngest/functions/sync-full";
import { syncDelta } from "@/inngest/functions/sync-delta";
import { syncCron } from "@/inngest/functions/sync-cron";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { sendMessage } from "@/inngest/functions/send-message";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncFull, syncDelta, syncCron, enrichContact, sendMessage],
});
