"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

type ListSummary = { id: string; name: string; memberCount: number };

interface ListPopoverProps {
  contactIds: string[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  placement?: "up" | "down";
}


export default function ListPopover({ contactIds, onClose, anchorRef, placement = "up" }: ListPopoverProps) {
  const { data, isLoading } = useSWR("/api/lists", fetcher);
  const lists: ListSummary[] = data?.lists ?? [];
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // listId or "new"
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleOutsideClick = useEffectEvent((e: MouseEvent) => {
    if (
      popoverRef.current &&
      !popoverRef.current.contains(e.target as Node) &&
      anchorRef.current &&
      !anchorRef.current.contains(e.target as Node)
    ) {
      onClose();
    }
  });

  // Close on outside click
  useEffect(() => {
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

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
      className={`absolute z-50 right-0 w-56 bg-surface border border-[var(--line)] rounded-xl shadow-2xl shadow-black/10 py-1 overflow-hidden ${placement === "up" ? "bottom-full mb-2" : "top-full mt-2"}`}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="size-4 text-[var(--faint)] animate-spin" />
        </div>
      ) : (
        <>
          {lists.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--faint)]">אין רשימות</p>
          )}
          {lists.map((list) => (
            <button
              type="button"
              key={list.id}
              onClick={() => addToList(list.id)}
              disabled={busy === list.id}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--surface-secondary)] transition-colors text-left"
            >
              <span className="truncate">{list.name}</span>
              <span className="shrink-0 text-[var(--faint)] font-mono">{list.memberCount}</span>
              {busy === list.id && <Loader2 className="size-3 animate-spin shrink-0 text-[var(--faint)]" />}
            </button>
          ))}
          <div className="border-t border-[var(--line)] mt-1 pt-1 px-2 pb-2">
            <div className="flex gap-1">
              <input
                aria-label="שם רשימה חדשה"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
                placeholder="שם רשימה חדשה"
                className="flex-1 min-w-0 bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-2 py-1 text-xs text-[var(--foreground)] placeholder-[var(--faint)] focus:outline-none focus:border-[var(--accent)]/60"
              />
              <button
                type="button"
                aria-label="צור רשימה חדשה"
                onClick={createAndAdd}
                disabled={!newName.trim() || busy === "new"}
                className="shrink-0 p-1.5 rounded-md bg-[var(--accent)] disabled:opacity-40 hover:bg-[var(--accent-strong)] transition-colors"
              >
                {busy === "new" ? (
                  <Loader2 className="size-3 text-white animate-spin" />
                ) : (
                  <Plus className="size-3 text-white" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
