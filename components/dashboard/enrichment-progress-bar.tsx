// components/dashboard/enrichment-progress-bar.tsx
"use client";

import { useEffect, useState } from "react";
import { ProgressBar } from "@heroui/react";
import { enrichmentProgress, type EnrichmentStoreState } from "@/lib/enrichment-progress";

export function EnrichmentProgressBar() {
  const [state, setState] = useState<EnrichmentStoreState>({ job: null, summary: null });

  useEffect(() => enrichmentProgress.subscribe(setState), []);

  const job = state.job;
  if (!job) return null;

  const value = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <div className="w-full bg-surface border-b border-[var(--line)] px-5 py-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium text-[var(--foreground)]">{job.label}</span>
        <span className="text-xs font-mono text-[var(--warning)]">
          {job.processed} / {job.total}
        </span>
      </div>
      <ProgressBar
        aria-label={job.label}
        value={value}
        minValue={0}
        maxValue={100}
        size="sm"
        color="warning"
        className="mt-1.5"
      >
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
    </div>
  );
}
