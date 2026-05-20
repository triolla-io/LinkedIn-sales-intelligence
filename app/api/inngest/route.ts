import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { campaignStart } from "@/inngest/functions/campaign-start";
import { campaignSendOne } from "@/inngest/functions/campaign-send-one";
import { campaignFinalize } from "@/inngest/functions/campaign-finalize";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [enrichContact, enrichCompanies, enrichCompaniesWeb, campaignStart, campaignSendOne, campaignFinalize],
});
