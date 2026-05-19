"use client";

import { useState } from "react";
import { Zap, RefreshCw, X, Send, Download, Megaphone } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";
import { NewCampaignModal } from "./new-campaign-modal";

interface BulkEnrichBarProps {
  selectedIds: string[];
  selectedContacts: Contact[];
  onDone?: () => void;
  onMessage?: (contact: Contact) => void;
}

export default function BulkEnrichBar({
  selectedIds,
  selectedContacts,
  onDone,
  onMessage,
}: BulkEnrichBarProps) {
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const N = selectedIds.length;

  async function doEnrich() {
    setShowConfirm(false);
    setEnriching(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts/bulk-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds }),
      });
      if (!res.ok) {
        setError(res.status === 402 ? "Credit limit reached" : "Enrichment failed");
        return;
      }
      onDone?.();
    } catch {
      setError("Network error");
    } finally {
      setEnriching(false);
    }
  }

  function handleEnrich() {
    if (N > 50) setShowConfirm(true);
    else doEnrich();
  }

  function exportCsv() {
    const headers = [
      "Name", "Title", "Company", "Email", "Phone", "Location", "Industry", "Seniority", "LinkedIn",
    ];
    const rows = selectedContacts.map((c) => [
      c.fullName,
      c.currentTitle ?? "",
      c.currentCompany ?? "",
      c.email ?? "",
      c.phone ?? "",
      c.location ?? "",
      c.industry ?? "",
      c.seniority ?? "",
      c.linkedinUrl,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLinkedInMessage() {
    if (selectedContacts.length === 1 && onMessage) {
      onMessage(selectedContacts[0]);
    }
  }

  if (N === 0) return null;

  return (
    <>
      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1a2d3f] border border-[#25405e] rounded-xl shadow-2xl p-6 w-96 max-w-[90vw]">
            <h3 className="font-semibold text-[#eaf2fd] mb-2">Enrich {N} contacts?</h3>
            <p className="text-sm text-[#5c7d9e] mb-5">
              This will consume credits for each contact that gets enriched.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-[#5c7d9e] hover:text-[#7a9aba] border border-[#25405e] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doEnrich}
                className="px-4 py-2 text-sm bg-[#f0a928] hover:bg-[#f5b840] text-[#0f1e2e] font-medium rounded-md transition-colors"
              >
                Confirm Enrich
              </button>
            </div>
          </div>
        </div>
      )}

      <NewCampaignModal
        open={campaignOpen}
        onClose={() => setCampaignOpen(false)}
        contactIds={selectedIds}
      />

      {/* Floating toolbar — slides up from bottom */}
      <div
        className={cn(
          "fixed bottom-0 left-[240px] right-0 z-30",
          "transition-transform duration-200 ease-out",
          N > 0 ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="mx-6 mb-5">
          <div className="flex items-center justify-between gap-4 bg-[#1a2d3f] border border-[#25405e] rounded-xl px-5 py-3 shadow-2xl shadow-black/40">
            {/* Left: count + error */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-[#eaf2fd]">
                <span className="text-[#1585ff] font-semibold">{N}</span>
                {" "}selected
              </span>
              {error && (
                <span className="text-xs text-red-400 font-mono">{error}</span>
              )}
              {enriching && (
                <span className="flex items-center gap-1.5 text-xs text-[#5c7d9e]">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Enriching…
                </span>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2">
              {N === 1 && (
                <button
                  onClick={handleLinkedInMessage}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#eaf2fd] border border-[#25405e] hover:border-[#1585ff]/40 hover:bg-[#1c3048] rounded-md transition-all"
                >
                  <Send className="w-3.5 h-3.5 text-[#1585ff]" />
                  Send LinkedIn Message
                </button>
              )}
              <button
                onClick={handleEnrich}
                disabled={enriching}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  enriching
                    ? "text-[#5c7d9e] border border-[#1e3248] cursor-not-allowed"
                    : "text-[#f0a928] border border-[#f0a928]/30 hover:bg-[#f0a928]/10 hover:border-[#f0a928]/50"
                )}
              >
                {enriching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Enrich
              </button>
              <button
                onClick={() => setCampaignOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1585ff] border border-[#1585ff]/30 hover:bg-[#1585ff]/10 hover:border-[#1585ff]/50 rounded-md transition-all"
              >
                <Megaphone className="w-3.5 h-3.5" />
                Send Campaign
              </button>
              <button
                onClick={exportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10 hover:border-emerald-500/30 rounded-md transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                onClick={onDone}
                className="p-1.5 text-[#456078] hover:text-[#5c7d9e] transition-colors ml-1"
                title="Deselect all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
