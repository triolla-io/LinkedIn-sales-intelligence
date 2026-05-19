"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export default function BackfillEnrichButton() {
  const [missing, setMissing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contacts/backfill-enrich")
      .then((r) => r.json())
      .then((d) => !cancelled && setMissing(d.missing ?? 0))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (missing === null || missing === 0) return null;

  async function trigger() {
    setBusy(true);
    try {
      await fetch("/api/contacts/backfill-enrich", { method: "POST" });
      setMissing(0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={trigger}
      disabled={busy}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
        "text-[#f0a928] border border-[#3a2e15] hover:border-[#5a4520] hover:bg-[#1a1408]",
        "disabled:opacity-50",
      )}
    >
      <Sparkles className="w-3.5 h-3.5" />
      {busy ? "Queuing…" : `Enrich ${missing.toLocaleString()} missing`}
    </button>
  );
}
