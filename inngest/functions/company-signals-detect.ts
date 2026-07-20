import { inngest } from "@/inngest/client";
import { detectAndRecordSignals } from "@/lib/company-signals/detect";

export const companySignalsDetect = inngest.createFunction(
  { id: "company-signals-detect", concurrency: 4, triggers: [{ event: "company.signals.detect" as const }] },
  async ({ event, step }) => {
    const { companyId } = event.data as { companyId: string };
    const { detected, verifiedNewIds } = await step.run("detect", () =>
      detectAndRecordSignals(companyId)
    );
    if (verifiedNewIds.length > 0) {
      await step.sendEvent(
        "fan-out-draft",
        verifiedNewIds.map((signalId) => ({ name: "company.signals.draft" as const, data: { signalId } }))
      );
    }
    return { detected, drafted: verifiedNewIds.length };
  }
);
