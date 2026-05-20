"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Loader2 } from "lucide-react";

type ListSummary = { id: string; name: string; memberCount: number };

interface ListPopoverProps {
  contactIds: string[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
}

export default function ListPopover({ contactIds, onClose, anchorRef }: ListPopoverProps) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // listId or "new"
  const [loading, setLoading] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/lists")
      .then((r) => r.json())
      .then((d) => setLists(d.lists ?? []))
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  async function addToList(listId: string) {
    setBusy(listId);
    await fetch(`/api/lists/${listId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ add: contactIds }),
    });
    setBusy(null);
    onClose();
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy("new");
    await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contactIds }),
    });
    setBusy(null);
    onClose();
  }

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bottom-full mb-2 w-56 bg-white border border-[#e5e3df] rounded-xl shadow-2xl shadow-black/10 py-1 overflow-hidden"
    >
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 text-[#9b9895] animate-spin" />
        </div>
      ) : (
        <>
          {lists.length === 0 && (
            <p className="px-3 py-2 text-xs text-[#9b9895]">No lists yet</p>
          )}
          {lists.map((list) => (
            <button
              key={list.id}
              onClick={() => addToList(list.id)}
              disabled={busy === list.id}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-[#111110] hover:bg-[#f8f7f5] transition-colors text-left"
            >
              <span className="truncate">{list.name}</span>
              <span className="shrink-0 text-[#9b9895] font-mono">{list.memberCount}</span>
              {busy === list.id && <Loader2 className="w-3 h-3 animate-spin shrink-0 text-[#9b9895]" />}
            </button>
          ))}
          <div className="border-t border-[#e5e3df] mt-1 pt-1 px-2 pb-2">
            <div className="flex gap-1">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
                placeholder="New list…"
                autoFocus
                className="flex-1 min-w-0 bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-2 py-1 text-xs text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/60"
              />
              <button
                onClick={createAndAdd}
                disabled={!newName.trim() || busy === "new"}
                className="shrink-0 p-1.5 rounded-md bg-[#1585ff] disabled:opacity-40 hover:bg-[#0a70e0] transition-colors"
              >
                {busy === "new" ? (
                  <Loader2 className="w-3 h-3 text-white animate-spin" />
                ) : (
                  <Plus className="w-3 h-3 text-white" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
