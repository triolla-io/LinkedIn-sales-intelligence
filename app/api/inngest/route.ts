import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichmentPropagate } from "@/inngest/functions/enrichment-propagate";
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
// TEMPORARILY DISABLED (2026-07-08): job-check crons paused while we fix the
// company-name comparison in recordJobChangeIfAny (exact string match produces
// false-positive job changes on casing/legal-suffix variants). Re-enable both
// ticks below once detect-change.ts uses normalized/fuzzy matching.
import { jobCheckTick } from "@/inngest/functions/job-check-tick";
import { jobCheckContact } from "@/inngest/functions/job-check-contact";
import { brightdataJobCheckTick } from "@/inngest/functions/brightdata-job-check-tick";
import { brightdataJobCheckCollect } from "@/inngest/functions/brightdata-job-check-collect";
import { hubspotSyncApollo } from "@/inngest/functions/hubspot-sync-apollo";
import { companySignalsTick } from "@/inngest/functions/company-signals-tick";
import { companySignalsDetect } from "@/inngest/functions/company-signals-detect";
import { companySignalsDraft } from "@/inngest/functions/company-signals-draft";
import { fintechRadarTick } from "@/inngest/functions/fintech-radar-tick";
import { fintechRadarMatch } from "@/inngest/functions/fintech-radar-match";
import { fintechRadarDraft } from "@/inngest/functions/fintech-radar-draft";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichContact,
    enrichmentPropagate,
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
    companySignalsTick,
    companySignalsDetect,
    companySignalsDraft,
    fintechRadarTick,
    fintechRadarMatch,
    fintechRadarDraft,
  ],
});
