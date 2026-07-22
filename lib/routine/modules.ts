import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export type RoutineModuleKey = "connections" | "jobChecks" | "companySignals";

export type RoutineModuleState = {
  connectionsEnabled: boolean;
  jobChecksEnabled: boolean;
  companySignalsEnabled: boolean;
};

/** connections is per-user; job checks and company signals are per-org. */
export async function getRoutineModuleState(userId: string): Promise<RoutineModuleState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      routineConnectionsEnabled: true,
      org: { select: { jobCheckEnabled: true, companySignalsEnabled: true } },
    },
  });
  return {
    connectionsEnabled: user?.routineConnectionsEnabled ?? true,
    jobChecksEnabled: user?.org.jobCheckEnabled ?? false,
    companySignalsEnabled: user?.org.companySignalsEnabled ?? false,
  };
}

export async function setRoutineModule(
  userId: string,
  module: RoutineModuleKey,
  enabled: boolean
): Promise<void> {
  if (module === "connections") {
    await prisma.user.update({ where: { id: userId }, data: { routineConnectionsEnabled: enabled } });
    return;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { orgId: true } });
  if (module === "jobChecks") {
    await prisma.organization.update({ where: { id: user.orgId }, data: { jobCheckEnabled: enabled } });
    // Kick-on-enable: dispatch a first batch immediately so it starts working right away
    // instead of waiting for the nightly cron.
    if (enabled) {
      await inngest.send({ name: "job-check.enabled" as const, data: { orgId: user.orgId } });
    }
    return;
  }
  await prisma.organization.update({ where: { id: user.orgId }, data: { companySignalsEnabled: enabled } });
}
