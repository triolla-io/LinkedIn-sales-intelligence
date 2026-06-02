"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, UserPlus, X } from "lucide-react";

type ContactResult = {
  id: string;
  fullName: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  email: string | null;
};

interface AddContactsToListModalProps {
  open: boolean;
  onClose: () => void;
  listId: string;
  onAdded: (count: number) => void;
}

export default function AddContactsToListModal({
  open,
  onClose,
  listId,
  onAdded,
}: AddContactsToListModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelected(new Set());
      setSearching(false);
      setAdding(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/contacts/search?q=${encodeURIComponent(query)}&excludeListId=${listId}&limit=20`
        );
        if (!res.ok) return;
        const data = await res.json();
        setResults(data.contacts ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, listId]);

  function toggleContact(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      await fetch(`/api/lists/${listId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: Array.from(selected) }),
      });
      onAdded(selected.size);
      onClose();
    } finally {
      setAdding(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="bg-white rounded-xl border border-[#e5e3df] shadow-2xl shadow-black/10 w-full max-w-md mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e3df]">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-[#1585ff]" />
            <span className="text-sm font-semibold text-[#111110]">הוסף אנשי קשר לרשימה</span>
          </div>
          <button
            onClick={onClose}
            className="text-[#9b9895] hover:text-[#6b6866] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 pt-3 pb-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חפש לפי שם או אימייל…"
            className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/60"
          />
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto min-h-[120px] max-h-72">
          {searching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 text-[#9b9895] animate-spin" />
            </div>
          )}
          {!searching && query.trim() === "" && (
            <p className="text-xs text-[#9b9895] text-center py-8">חפש אנשי קשר להוספה</p>
          )}
          {!searching && query.trim() !== "" && results.length === 0 && (
            <p className="text-xs text-[#9b9895] text-center py-8">לא נמצאו אנשי קשר</p>
          )}
          {!searching &&
            results.map((contact) => {
              const isSelected = selected.has(contact.id);
              return (
                <button
                  key={contact.id}
                  onClick={() => toggleContact(contact.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isSelected ? "bg-[#1585ff]/5" : "hover:bg-[#f8f7f5]"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? "bg-[#1585ff] border-[#1585ff]"
                        : "border-[#d1cfc9] bg-white"
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#111110] truncate">{contact.fullName ?? "—"}</p>
                    <p className="text-[11px] text-[#9b9895] truncate">
                      {[contact.currentTitle, contact.currentCompany].filter(Boolean).join(" · ")}
                      {contact.email && (
                        <span className="ml-1 text-[#b0adaa]">{contact.email}</span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[#e5e3df]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-[#6b6866] hover:text-[#111110] transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={handleAdd}
            disabled={selected.size === 0 || adding}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-[#1585ff] hover:bg-[#0a70e0] rounded-md transition-colors disabled:opacity-40"
          >
            {adding ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <UserPlus className="w-3 h-3" />
            )}
            {selected.size > 0 ? `הוסף ${selected.size} אנשי קשר` : "הוסף"}
          </button>
        </div>
      </div>
    </div>
  );
}
