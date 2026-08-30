"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export type RoutineModules = {
  connectionsEnabled: boolean;
  jobChecksEnabled: boolean;
  companySignalsEnabled: boolean;
  fintechRadarEnabled: boolean;
  techRadarEnabled: boolean;
  postCommentsEnabled: boolean;
};
export type RoutineModuleKey =
  | "connections"
  | "jobChecks"
  | "companySignals"
  | "fintechRadar"
  | "techRadar"
  | "postComments";

const MODULE_STATE_KEY: Record<RoutineModuleKey, keyof RoutineModules> = {
  connections: "connectionsEnabled",
  jobChecks: "jobChecksEnabled",
  companySignals: "companySignalsEnabled",
  fintechRadar: "fintechRadarEnabled",
  techRadar: "techRadarEnabled",
  postComments: "postCommentsEnabled",
};


export function useRoutineModules() {
  const { data, mutate, isLoading } = useSWR<RoutineModules>("/api/routine/modules", fetcher);

  async function setModule(module: RoutineModuleKey, enabled: boolean) {
    const key = MODULE_STATE_KEY[module];
    await mutate(
      async () => {
        const res = await fetch("/api/routine/modules", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ module, enabled }),
        });
        if (!res.ok) throw new Error("toggle_failed");
        return res.json();
      },
      { optimisticData: data ? { ...data, [key]: enabled } : undefined, revalidate: false }
    );
  }

  return { modules: data, isLoading, setModule };
}
