import { prisma } from "@/lib/prisma";
import type { Prisma, ProspectingEventType } from "@/lib/generated/prisma/client";

export type { ProspectingEventType };

export async function logProspectingEvent(input: {
  runId: string;
  type: ProspectingEventType;
  connectionRequestId?: string | null;
  message?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.prospectingEvent.create({
      data: {
        runId: input.runId,
        type: input.type,
        connectionRequestId: input.connectionRequestId ?? undefined,
        message: input.message,
        detail: input.detail as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    // Logging must never break the pipeline.
  }
}
