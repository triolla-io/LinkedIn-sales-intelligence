"use client";

import { useReducer, useRef } from "react";
import { Zap, RefreshCw, X, Megaphone, Bookmark } from "lucide-react";
import { cn } from "@/lib/cn";
import { runBatchEnrichment } from "@/lib/enrichment-progress";
import type { Contact } from "./contact-table";
import { NewCampaignModal } from "./new-campaign-modal";
import ListPopover from "./list-popover";

interface BulkEnrichBarProps {
  selectedIds: string[];
  selectedContacts: Contact[];
  onDone?: () => void;
}

type State = {
  enriching: boolean;
  error: string | null;
  notice: string | null;
  showConfirm: boolean;
  campaignOpen: boolean;
  showListPopover: boolean;
};

export default function BulkEnrichBar({
  selectedIds,
  onDone,
}: BulkEnrichBarProps) {
  const [state, dispatch] = useReducer(
    (s: State, action: Partial<State>) => ({ ...s, ...action }),
    {
      enriching: false,
      error: null,
      notice: null,
      showConfirm: false,
      campaignOpen: false,
      showListPopover: false,
    }
  );
  const listBtnRef = useRef<HTMLButtonElement>(null);

  const N = selectedIds.length;

  async function doEnrich() {
    dispatch({ showConfirm: false, enriching: true, error: null, notice: null });
    const since = new Date().toISOString();
    try {
      const res = await fetch("/api/contacts/bulk-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds }),
      });
      if (!res.ok) {
        dispatch({ error: res.status === 402 ? "Credit limit reached" : "Enrichment failed" });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        queued?: number;
        skipped?: number;
        creditsRemaining?: number;
      };
      const queued = data.queued ?? 0;
      const skipped = data.skipped ?? 0;
      dispatch({
        notice:
          skipped > 0
            ? `${queued} בתור להעשרה · ${skipped} דולגו (חריגה מתקציב הקרדיטים)`
            : `${queued} בתור להעשרה ברקע`,
      });
      if (queued > 0) {
        // Fire-and-forget: the global bar + modal own the rest of the lifecycle.
        void runBatchEnrichment({
          kind: "bulk",
          label: `מעשיר ${queued} אנשי קשר`,
          total: queued,
          contactIds: selectedIds,
          since,
          skipped,
          creditsRemaining: data.creditsRemaining ?? null,
        });
      }
      onDone?.();
    } catch {
      dispatch({ error: "Network error" });
    } finally {
      dispatch({ enriching: false });
    }
  }

  function handleEnrich() {
    if (N > 50) dispatch({ showConfirm: true });
    else doEnrich();
  }

  if (N === 0) return null;

  return (
    <>
      {/* Confirm dialog */}
      {state.showConfirm && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white border border-[#e5e3df] rounded-xl shadow-2xl p-6 w-96 max-w-[90vw]">
            <h3 className="font-semibold text-[#111110] mb-2">העשר {N} אנשי קשר?</h3>
            <p className="text-sm text-[#6b6866] mb-5">
              זה יצרוך קרדיטים עבור כל איש קשר שיתועשר.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => dispatch({ showConfirm: false })}
                className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] border border-[#e5e3df] hover:border-[#9b9895] rounded-md transition-colors"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={doEnrich}
                className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-md transition-colors"
              >
                אישור העשר
              </button>
            </div>
          </div>
        </div>
      )}

      <NewCampaignModal
        open={state.campaignOpen}
        onClose={() => dispatch({ campaignOpen: false })}
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
                {" "}נבחרו
              </span>
              {state.error && (
                <span className="text-xs text-red-500 font-mono">{state.error}</span>
              )}
              {state.notice && !state.enriching && (
                <span className="text-xs text-amber-600 font-mono">{state.notice}</span>
              )}
              {state.enriching && (
                <span className="flex items-center gap-1.5 text-xs text-[#9b9895]">
                  <RefreshCw className="size-3 animate-spin" />
                  מעשר…
                </span>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  ref={listBtnRef}
                  onClick={() => dispatch({ showListPopover: !state.showListPopover })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6b6866] border border-[#e5e3df] hover:bg-[#f8f7f5] hover:border-[#9b9895] rounded-md transition-all"
                >
                  <Bookmark className="size-3.5" />
                  שמור לרשימה
                </button>
                {state.showListPopover && (
                  <ListPopover
                    contactIds={selectedIds}
                    onClose={() => dispatch({ showListPopover: false })}
                    anchorRef={listBtnRef as React.RefObject<HTMLElement>}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={handleEnrich}
                disabled={state.enriching}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  state.enriching
                    ? "text-[#9b9895] border border-[#e5e3df] cursor-not-allowed"
                    : "text-amber-600 border border-amber-200 hover:bg-amber-50 hover:border-amber-300"
                )}
              >
                {state.enriching ? <RefreshCw className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                העשר
              </button>
              <button
                type="button"
                onClick={() => dispatch({ campaignOpen: true })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 hover:border-blue-300 rounded-md transition-all"
              >
                <Megaphone className="size-3.5" />
                שלח קמפיין
              </button>
              <button
                type="button"
                onClick={onDone}
                className="p-1.5 text-[#9b9895] hover:text-[#6b6866] transition-colors ml-1"
                title="בטל את כל הבחירות"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
