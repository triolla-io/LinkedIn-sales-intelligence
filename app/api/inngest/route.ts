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
import { jobCheckTick } from "@/inngest/functions/job-check-tick";
import { jobCheckDispatchOnEnable } from "@/inngest/functions/job-check-dispatch";
import { hubspotSyncApollo } from "@/inngest/functions/hubspot-sync-apollo";
import { companySignalsTick } from "@/inngest/functions/company-signals-tick";
import { companySignalsDispatchOnEnable } from "@/inngest/functions/company-signals-dispatch";
import { companySignalsDetect } from "@/inngest/functions/company-signals-detect";
import { companySignalsDraft } from "@/inngest/functions/company-signals-draft";
import { fintechRadarTick } from "@/inngest/functions/fintech-radar-tick";
import { fintechRadarDispatchOnEnable } from "@/inngest/functions/fintech-radar-dispatch";
import { fintechRadarMatch } from "@/inngest/functions/fintech-radar-match";
import { fintechRadarDraft } from "@/inngest/functions/fintech-radar-draft";
import { techRadarTick, techRadarRefreshTick } from "@/inngest/functions/tech-radar-tick";
import { techRadarDispatchOnEnable } from "@/inngest/functions/tech-radar-dispatch";
import { techRadarResearch } from "@/inngest/functions/tech-radar-research";
import { techRadarScan } from "@/inngest/functions/tech-radar-scan";
import { techRadarPersonScan } from "@/inngest/functions/tech-radar-person-scan";
import { techRadarRunMarked } from "@/inngest/functions/tech-radar-run-marked";
import { techRadarDraft } from "@/inngest/functions/tech-radar-draft";

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
    jobCheckDispatchOnEnable,
    hubspotSyncApollo,
    companySignalsTick,
    companySignalsDispatchOnEnable,
    companySignalsDetect,
    companySignalsDraft,
    fintechRadarTick,
    fintechRadarDispatchOnEnable,
    fintechRadarMatch,
    fintechRadarDraft,
    techRadarTick,
    techRadarRefreshTick,
    techRadarDispatchOnEnable,
    techRadarResearch,
    techRadarScan,
    techRadarRunMarked,
    techRadarPersonScan,
    techRadarDraft,
  ],
});
