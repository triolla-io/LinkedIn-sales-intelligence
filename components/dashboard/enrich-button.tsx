"use client";

import { useState } from "react";
import { Zap, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";

interface EnrichButtonProps {
  contactId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  onEnriched?: () => void;
}

export default function EnrichButton({ contactId, hasEmail, hasPhone, onEnriched }: EnrichButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleEnrich() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/contacts/${contactId}/enrich`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 402 || data?.error === "BUDGET_EXHAUSTED") {
          setError("Credit limit reached");
        } else {
          setError("Enrichment failed");
        }
        return;
      }
      setDone(true);
      onEnriched?.();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <span className="text-xs text-red-500 font-medium">{error}</span>
    );
  }

  return (
    <button
      onClick={handleEnrich}
      disabled={loading || done}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
        done
          ? "bg-green-50 text-green-600 cursor-default"
          : "bg-blue-50 text-blue-600 hover:bg-blue-100"
      )}
    >
      {loading ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : (
        <Zap className="w-3 h-3" />
      )}
      {done ? "הועשר" : "העשר"}
    </button>
  );
}
