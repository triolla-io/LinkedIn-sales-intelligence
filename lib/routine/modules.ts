import { prisma } from "@/lib/prisma";

export type RoutineModuleKey = "connections" | "jobChecks";

export type RoutineModuleState = {
  connectionsEnabled: boolean;
  jobChecksEnabled: boolean;
};

/** Both Routine module switches for a user: connections is per-user, job checks is per-org. */
export async function getRoutineModuleState(userId: string): Promise<RoutineModuleState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { routineConnectionsEnabled: true, org: { select: { jobCheckEnabled: true } } },
  });
  return {
    connectionsEnabled: user?.routineConnectionsEnabled ?? true,
    jobChecksEnabled: user?.org.jobCheckEnabled ?? false,
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
  await prisma.organization.update({ where: { id: user.orgId }, data: { jobCheckEnabled: enabled } });
}
