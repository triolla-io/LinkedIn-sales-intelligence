import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export type RoutineModuleKey =
  | "connections"
  | "jobChecks"
  | "companySignals"
  | "fintechRadar"
  | "techRadar"
  | "postComments";

export type RoutineModuleState = {
  connectionsEnabled: boolean;
  jobChecksEnabled: boolean;
  companySignalsEnabled: boolean;
  fintechRadarEnabled: boolean;
  techRadarEnabled: boolean;
  postCommentsEnabled: boolean;
};

/** connections is per-user; every other module is per-org. */
export async function getRoutineModuleState(userId: string): Promise<RoutineModuleState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      routineConnectionsEnabled: true,
      org: {
        select: {
          jobCheckEnabled: true,
          companySignalsEnabled: true,
          fintechRadarEnabled: true,
          techRadarEnabled: true,
          postCommentsEnabled: true,
        },
      },
    },
  });
  return {
    connectionsEnabled: user?.routineConnectionsEnabled ?? true,
    jobChecksEnabled: user?.org.jobCheckEnabled ?? false,
    companySignalsEnabled: user?.org.companySignalsEnabled ?? false,
    fintechRadarEnabled: user?.org.fintechRadarEnabled ?? false,
    techRadarEnabled: user?.org.techRadarEnabled ?? false,
    postCommentsEnabled: user?.org.postCommentsEnabled ?? false,
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
  if (module === "companySignals") {
    await prisma.organization.update({ where: { id: user.orgId }, data: { companySignalsEnabled: enabled } });
    // Kick-on-enable: dispatch a first detect batch immediately instead of waiting for the weekly cron.
    if (enabled) {
      await inngest.send({ name: "company.signals.enabled" as const, data: { orgId: user.orgId } });
    }
    return;
  }
  if (module === "fintechRadar") {
    await prisma.organization.update({ where: { id: user.orgId }, data: { fintechRadarEnabled: enabled } });
    // Kick-on-enable: fetch news + dispatch matching for this org immediately instead of waiting for the weekly cron.
    if (enabled) {
      await inngest.send({ name: "fintech.radar.enabled" as const, data: { orgId: user.orgId } });
    }
    return;
  }
  if (module === "postComments") {
    await prisma.organization.update({ where: { id: user.orgId }, data: { postCommentsEnabled: enabled } });
    // Kick-on-enable: dispatch a first scan batch immediately for this org instead of
    // waiting for the daily cron.
    if (enabled) {
      await inngest.send({ name: "post-comments.enabled" as const, data: { orgId: user.orgId } });
    }
    return;
  }
  await prisma.organization.update({ where: { id: user.orgId }, data: { techRadarEnabled: enabled } });
  // Kick-on-enable: research any company still waiting, then scan immediately, instead of
  // waiting for the weekly cron.
  if (enabled) {
    await inngest.send({ name: "tech-radar.enabled" as const, data: { orgId: user.orgId } });
  }
}
