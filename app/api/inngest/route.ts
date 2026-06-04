import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { enrichContactsHaiku, enrichContactsHaikuScheduled } from "@/inngest/functions/enrich-contacts-haiku";
import { sequenceStart } from "@/inngest/functions/sequence-start";
import { sequenceTick } from "@/inngest/functions/sequence-tick";
import { sequenceSendExecution } from "@/inngest/functions/sequence-send-execution";
import { extensionTaskResult } from "@/inngest/functions/extension-task-result";
import { extensionHeartbeatWatch } from "@/inngest/functions/extension-heartbeat-watch";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichContact,
    enrichCompanies,
    enrichCompaniesWeb,
    enrichContactsHaiku,
    enrichContactsHaikuScheduled,
    sequenceStart,
    sequenceTick,
    sequenceSendExecution,
    extensionTaskResult,
    extensionHeartbeatWatch,
  ],
});
