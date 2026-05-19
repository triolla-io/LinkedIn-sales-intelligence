"use client";

import { useState } from "react";
import { Zap, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface BulkEnrichBarProps {
  selectedIds: string[];
  orgId?: string;
  onDone?: () => void;
}

export default function BulkEnrichBar({ selectedIds, onDone }: BulkEnrichBarProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const N = selectedIds.length;

  async function doEnrich() {
    setShowConfirm(false);
    setLoading(true);
    setError(null);
    setProgress({ done: 0, total: N });

    try {
      const res = await fetch("/api/contacts/bulk-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds }),
      });

      if (!res.ok) {
        if (res.status === 402) {
          setError("Credit limit reached");
        } else {
          setError("Enrichment failed. Please try again.");
        }
        return;
      }

      setProgress({ done: N, total: N });
      onDone?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleClick() {
    if (N > 50) {
      setShowConfirm(true);
    } else {
      doEnrich();
    }
  }

  if (N === 0) return null;

  return (
    <>
      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96 max-w-[90vw]">
            <h3 className="font-semibold text-gray-900 mb-2">Enrich {N} contacts?</h3>
            <p className="text-sm text-gray-600 mb-4">
              You are about to enrich {N} contacts. This will consume credits for each contact.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doEnrich}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Confirm Enrich
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky bar */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex items-center justify-between z-30">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">
            {N} contact{N !== 1 ? "s" : ""} selected
          </span>
          {error && (
            <span className="text-sm text-red-500">{error}</span>
          )}
          {loading && progress && (
            <span className="text-sm text-blue-600">
              Enriching... {progress.done}/{progress.total}
            </span>
          )}
        </div>

        <button
          onClick={handleClick}
          disabled={loading}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
            loading
              ? "bg-blue-400 text-white cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          )}
        >
          {loading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          Enrich {N} contacts
        </button>
      </div>
    </>
  );
}
