import { inngest } from "@/inngest/client";
import { propagateEnrichment, type PropagatableValues } from "@/lib/enrichment/propagate";

/**
 * Fills newly-enriched values into every other contact in the same org that
 * shares the same LinkedIn profile. Fires after each successful enrichment
 * (see enrichContactCore) so all users in an org see the data without each
 * having to re-run enrich. Idempotent — only empty fields are filled.
 */
export const enrichmentPropagate = inngest.createFunction(
  { id: "enrichment-propagate", triggers: [{ event: "enrichment.propagate" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { orgId, linkedinUrlNormalized, sourceContactId, values } = event.data as {
      orgId: string;
      linkedinUrlNormalized: string;
      sourceContactId?: string;
      values: PropagatableValues;
    };

    const result = await step.run("propagate", () =>
      propagateEnrichment({ orgId, linkedinUrlNormalized, sourceContactId, values })
    );

    return result;
  }
);
