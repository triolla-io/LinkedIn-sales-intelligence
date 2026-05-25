import { inngest } from "@/inngest/client";
import { executeSequenceSend } from "@/lib/sequences/execute-send";

const RETRY_DELAY_MS = 60_000;

export const sequenceSendExecution = inngest.createFunction(
  { id: "sequence-send-execution", triggers: [{ event: "sequence.send-execution" as const }] },
  async ({ event }) => {
    const { executionId } = event.data as { executionId: string };
    const result = await executeSequenceSend(executionId);

    if (result.outcome === "rate_limited") {
      await inngest.send({
        name: "sequence.send-execution" as const,
        data: { executionId },
        ts: Date.now() + result.retryAfterSec * 1000,
      });
      return;
    }

    if (result.outcome === "failed" && result.willRetry) {
      await inngest.send({
        name: "sequence.send-execution" as const,
        data: { executionId },
        ts: Date.now() + RETRY_DELAY_MS,
      });
    }
  }
);
