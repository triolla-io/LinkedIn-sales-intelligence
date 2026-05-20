"use client";

import { useState, useRef } from "react";
import { Zap, RefreshCw, X, Send, Download, Megaphone, Bookmark } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";
import { NewCampaignModal } from "./new-campaign-modal";
import ListPopover from "./list-popover";

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
  const [showListPopover, setShowListPopover] = useState(false);
  const listBtnRef = useRef<HTMLButtonElement>(null);

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
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white border border-[#e5e3df] rounded-xl shadow-2xl p-6 w-96 max-w-[90vw]">
            <h3 className="font-semibold text-[#111110] mb-2">Enrich {N} contacts?</h3>
            <p className="text-sm text-[#6b6866] mb-5">
              This will consume credits for each contact that gets enriched.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] border border-[#e5e3df] hover:border-[#9b9895] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doEnrich}
                className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-md transition-colors"
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
          <div className="flex items-center justify-between gap-4 bg-white border border-[#e5e3df] rounded-xl px-5 py-3 shadow-lg">
            {/* Left: count + error */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-[#111110]">
                <span className="text-[#1585ff] font-semibold">{N}</span>
                {" "}selected
              </span>
              {error && (
                <span className="text-xs text-red-500 font-mono">{error}</span>
              )}
              {enriching && (
                <span className="flex items-center gap-1.5 text-xs text-[#9b9895]">
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
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#111110] border border-[#e5e3df] hover:border-blue-200 hover:bg-[#eff5ff] hover:text-[#1585ff] rounded-md transition-all"
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
                    ? "text-[#9b9895] border border-[#e5e3df] cursor-not-allowed"
                    : "text-amber-600 border border-amber-200 hover:bg-amber-50 hover:border-amber-300"
                )}
              >
                {enriching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Enrich
              </button>
              <button
                onClick={() => setCampaignOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 hover:border-blue-300 rounded-md transition-all"
              >
                <Megaphone className="w-3.5 h-3.5" />
                Send Campaign
              </button>
              <button
                onClick={exportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 border border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 rounded-md transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                onClick={onDone}
                className="p-1.5 text-[#9b9895] hover:text-[#6b6866] transition-colors ml-1"
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
