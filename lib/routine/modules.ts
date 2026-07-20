import { prisma } from "@/lib/prisma";

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
    return;
  }
  await prisma.organization.update({ where: { id: user.orgId }, data: { companySignalsEnabled: enabled } });
}
