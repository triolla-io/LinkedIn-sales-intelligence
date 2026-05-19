"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

type Progress = { processed: number; total: number };

export default function EnrichBanner() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/sse/stream");

    es.addEventListener("linkedin:enrich-progress", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Progress;
      setProgress(data);
    });

    es.addEventListener("linkedin:enrich-done", () => {
      setProgress(null);
      setDismissed(false);
    });

    return () => es.close();
  }, []);

  if (!progress || dismissed) return null;
  const pct = progress.total === 0 ? 100 : Math.round((progress.processed / progress.total) * 100);

  return (
    <div className="mx-4 mt-4 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#1585ff]/10 border border-[#1585ff]/20">
      <Sparkles className="w-4 h-4 text-[#1585ff] shrink-0 animate-pulse" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs text-[#9ecfff]">
          <span>Enriching companies via Apollo…</span>
          <span className="font-mono text-[#5c7d9e]">{progress.processed} / {progress.total}</span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-[#1585ff]/10 overflow-hidden">
          <div className="h-full bg-[#1585ff] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-[#5c7d9e] hover:text-[#9ecfff] transition-colors"
        aria-label="Hide"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
