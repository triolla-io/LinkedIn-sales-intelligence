"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookMarked, Trash2, Loader2 } from "lucide-react";

type ListSummary = { id: string; name: string; memberCount: number; createdAt: string };

export default function ListsPage() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchLists() {
    const res = await fetch("/api/lists");
    if (res.ok) {
      const data = await res.json();
      setLists(data.lists ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { fetchLists(); }, []);

  async function deleteList(id: string) {
    setDeletingId(id);
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    setLists((prev) => prev.filter((l) => l.id !== id));
    setDeletingId(null);
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <BookMarked className="w-4 h-4 text-[#1585ff]" />
          <h1 className="text-sm font-semibold text-[#111110] tracking-tight">Lists</h1>
          {!loading && (
            <span className="text-xs font-mono text-[#9b9895]">{lists.length} total</span>
          )}
        </div>
      </div>

      <div className="px-5 py-5 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-[#9b9895] animate-spin" />
          </div>
        ) : lists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookMarked className="w-8 h-8 text-[#d4d0cc] mb-3" />
            <p className="text-sm text-[#6b6866]">No lists yet</p>
            <p className="text-xs text-[#9b9895] mt-1">
              Select contacts on the{" "}
              <Link href="/contacts" className="text-[#1585ff] hover:underline">Contacts page</Link>{" "}
              and choose &ldquo;Save to List&rdquo;.
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
                      {list.memberCount} contact{list.memberCount !== 1 ? "s" : ""}
                    </p>
                    <p className="text-[10px] text-[#c8c5c2] mt-2">
                      {new Date(list.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                  <button
                    onClick={() => deleteList(list.id)}
                    disabled={deletingId === list.id}
                    className="shrink-0 p-1.5 text-[#d4d0cc] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete list"
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
