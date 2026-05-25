import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { enrichContactsHaiku } from "@/inngest/functions/enrich-contacts-haiku";
import { campaignStart } from "@/inngest/functions/campaign-start";
import { campaignSendOne } from "@/inngest/functions/campaign-send-one";
import { campaignSendWhatsapp } from "@/inngest/functions/campaign-send-whatsapp";
import { campaignSendEmail } from "@/inngest/functions/campaign-send-email";
import { campaignFinalize } from "@/inngest/functions/campaign-finalize";
import { sequenceStart } from "@/inngest/functions/sequence-start";
import { sequenceTick } from "@/inngest/functions/sequence-tick";
import { sequenceSendExecution } from "@/inngest/functions/sequence-send-execution";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichContact,
    enrichCompanies,
    enrichCompaniesWeb,
    enrichContactsHaiku,
    campaignStart,
    campaignSendOne,
    campaignSendWhatsapp,
    campaignSendEmail,
    campaignFinalize,
    sequenceStart,
    sequenceTick,
    sequenceSendExecution,
  ],
});
