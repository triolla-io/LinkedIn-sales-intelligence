import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { syncFull } from "@/inngest/functions/sync-full";
import { syncDelta } from "@/inngest/functions/sync-delta";
import { syncCron } from "@/inngest/functions/sync-cron";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { sendMessage } from "@/inngest/functions/send-message";
import { profileEnrich } from "@/inngest/functions/profile-enrich";
import { enrichProfiles } from "@/inngest/functions/enrich-profiles";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { campaignStart } from "@/inngest/functions/campaign-start";
import { campaignSendOne } from "@/inngest/functions/campaign-send-one";
import { campaignFinalize } from "@/inngest/functions/campaign-finalize";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncFull, syncDelta, syncCron, enrichContact, sendMessage, profileEnrich, enrichProfiles, enrichCompanies, campaignStart, campaignSendOne, campaignFinalize],
});
