import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { enrichContactsHebrewNames, enrichContactsHebrewNamesScheduled } from "@/inngest/functions/enrich-contacts-hebrew-names";
import { sequenceStart } from "@/inngest/functions/sequence-start";
import { sequenceTick } from "@/inngest/functions/sequence-tick";
import { sequenceSendExecution } from "@/inngest/functions/sequence-send-execution";
import { extensionTaskResult } from "@/inngest/functions/extension-task-result";
import { extensionHeartbeatWatch } from "@/inngest/functions/extension-heartbeat-watch";
import { prospectingStart } from "@/inngest/functions/prospecting-start";
import { prospectingTick } from "@/inngest/functions/prospecting-tick";
import { importProcess } from "@/inngest/functions/import-process";
import { jobCheckTick } from "@/inngest/functions/job-check-tick";
import { jobCheckContact } from "@/inngest/functions/job-check-contact";
import { brightdataJobCheckTick } from "@/inngest/functions/brightdata-job-check-tick";
import { brightdataJobCheckCollect } from "@/inngest/functions/brightdata-job-check-collect";
import { hubspotSyncApollo } from "@/inngest/functions/hubspot-sync-apollo";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichContact,
    enrichCompanies,
    enrichCompaniesWeb,
    enrichContactsHebrewNames,
    enrichContactsHebrewNamesScheduled,
    sequenceStart,
    sequenceTick,
    sequenceSendExecution,
    extensionTaskResult,
    extensionHeartbeatWatch,
    prospectingStart,
    prospectingTick,
    importProcess,
    jobCheckTick,
    jobCheckContact,
    brightdataJobCheckTick,
    brightdataJobCheckCollect,
    hubspotSyncApollo,
  ],
});
