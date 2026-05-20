"use client";

import { useEffect, useState } from "react";

type State =
  | { phase: "idle" }
  | { phase: "running"; done: number; total: number }
  | { phase: "done" };

export default function EnrichmentProgress() {
  const [state, setState] = useState<State>({ phase: "idle" });

  useEffect(() => {
    const es = new EventSource("/api/sync/status");

    es.addEventListener("linkedin:enrich-started", (e) => {
      const { total } = JSON.parse((e as MessageEvent).data);
      setState({ phase: "running", done: 0, total });
    });

    es.addEventListener("linkedin:enrich-progress", (e) => {
      const { done, total } = JSON.parse((e as MessageEvent).data);
      setState({ phase: "running", done, total });
    });

    es.addEventListener("linkedin:enrich-done", () => {
      setState({ phase: "done" });
      setTimeout(() => setState({ phase: "idle" }), 2000);
    });

    return () => es.close();
  }, []);

  if (state.phase === "idle") return null;

  const pct =
    state.phase === "running" && state.total > 0
      ? Math.min(100, Math.round((state.done / state.total) * 100))
      : 100;

  return (
    <div className="border-b border-[#e5e3df] bg-[#eff5ff] px-6 py-2">
      <div className="flex items-center gap-3 text-sm text-[#111110]">
        <span className="shrink-0">
          {state.phase === "done"
            ? "Enrichment complete"
            : `Enriching ${state.done} of ${state.total} contacts… (location, industry, company size)`}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-blue-100">
          <div
            className="h-full bg-[#1585ff] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
