"use client";

import useSWR from "swr";

export type RoutineModules = { connectionsEnabled: boolean; jobChecksEnabled: boolean };
export type RoutineModuleKey = "connections" | "jobChecks";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

export function useRoutineModules() {
  const { data, mutate, isLoading } = useSWR<RoutineModules>("/api/routine/modules", fetcher);

  async function setModule(module: RoutineModuleKey, enabled: boolean) {
    const key = module === "connections" ? "connectionsEnabled" : "jobChecksEnabled";
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
