"use client";

import { useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { BookMarked, Trash2, Loader2, Plus, X } from "lucide-react";

type ListSummary = { id: string; name: string; memberCount: number; createdAt: string };

export default function ListsPage() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchLists() {
    try {
      const res = await fetch("/api/lists");
      if (res.ok) {
        const data = await res.json();
        setLists(data.lists ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useAutoRefresh(fetchLists, 30_000);

  async function deleteList(id: string) {
    setDeletingId(id);
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    setLists((prev) => prev.filter((l) => l.id !== id));
    setDeletingId(null);
  }

  async function createList() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setLists((prev) => [{ ...data.list, memberCount: 0 }, ...prev]);
        setNewName("");
        setCreating(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function cancelCreate() {
    setCreating(false);
    setNewName("");
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <BookMarked className="w-4 h-4 text-[#1585ff]" />
          <h1 className="text-sm font-semibold text-[#111110] tracking-tight">רשימות תפוצה</h1>
          {!loading && (
            <span className="text-xs font-mono text-[#9b9895]">סה&quot;כ {lists.length}</span>
          )}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1585ff] hover:bg-[#0d6edb] rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          הוסף רשימה חדשה
        </button>
      </div>

      <div className="px-5 py-5 flex-1">
        {creating && (
          <div className="mb-4 bg-white border border-[#1585ff] rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-[#111110] mb-2">שם הרשימה</p>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createList();
                  if (e.key === "Escape") cancelCreate();
                }}
                placeholder="למשל: לידים חמים Q2"
                className="flex-1 text-sm px-3 py-2 border border-[#e5e3df] rounded-lg outline-none focus:border-[#1585ff] bg-[#f6f5f3] placeholder:text-[#c8c5c2]"
              />
              <button
                onClick={createList}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#1585ff] hover:bg-[#0d6edb] disabled:opacity-50 rounded-lg transition-colors"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "צור"}
              </button>
              <button
                onClick={cancelCreate}
                className="p-2 text-[#9b9895] hover:text-[#6b6866] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-[#9b9895] animate-spin" />
          </div>
        ) : lists.length === 0 && !creating ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookMarked className="w-8 h-8 text-[#d4d0cc] mb-3" />
            <p className="text-sm text-[#6b6866]">אין רשימות עדיין</p>
            <p className="text-xs text-[#9b9895] mt-1">
              בחר אנשי קשר בדף <Link href="/contacts" className="text-[#1585ff] hover:underline">אנשי קשר</Link> ולחץ &ldquo;שמור לרשימה&rdquo;.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {lists.map((list) => (
              <div
                key={list.id}
                className="bg-white border border-[#e5e3df] rounded-xl p-4 hover:border-[#9b9895] transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/lists/${list.id}`}
                    className="flex-1 min-w-0"
                  >
                    <p className="text-sm font-medium text-[#111110] truncate group-hover:text-[#1585ff] transition-colors">
                      {list.name}
                    </p>
                    <p className="text-xs text-[#9b9895] mt-1 font-mono">
                      {list.memberCount} אנשי קשר
                    </p>
                    <p className="text-[10px] text-[#c8c5c2] mt-2">
                      {new Date(list.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                  <button
                    onClick={() => deleteList(list.id)}
                    disabled={deletingId === list.id}
                    className="shrink-0 p-1.5 text-[#d4d0cc] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="מחק"
                  >
                    {deletingId === list.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
