"use client";

import { useReducer } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { BookMarked, Trash2, Loader2, Plus, X } from "lucide-react";

type ListSummary = { id: string; name: string; memberCount: number; createdAt: string };

type State = {
  lists: ListSummary[];
  loading: boolean;
  deletingId: string | null;
  creating: boolean;
  newName: string;
  saving: boolean;
};

export default function ListsPage() {
  const [state, dispatch] = useReducer(
    (s: State, action: Partial<State>) => ({ ...s, ...action }),
    {
      lists: [],
      loading: true,
      deletingId: null,
      creating: false,
      newName: "",
      saving: false,
    }
  );

  async function fetchLists() {
    try {
      const res = await fetch("/api/lists");
      if (res.ok) {
        const data = await res.json();
        dispatch({ lists: data.lists ?? [] });
      }
    } finally {
      dispatch({ loading: false });
    }
  }

  useAutoRefresh(fetchLists, 30_000);

  async function deleteList(id: string) {
    dispatch({ deletingId: id });
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    dispatch({ lists: state.lists.filter((l) => l.id !== id), deletingId: null });
  }

  async function createList() {
    if (!state.newName.trim()) return;
    dispatch({ saving: true });
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: state.newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        dispatch({
          lists: [{ ...data.list, memberCount: 0 }, ...state.lists],
          newName: "",
          creating: false,
        });
      }
    } finally {
      dispatch({ saving: false });
    }
  }

  function cancelCreate() {
    dispatch({ creating: false, newName: "" });
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-[var(--background)]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--line)] bg-surface sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <BookMarked className="size-4 text-[var(--accent)]" />
          <h1 className="text-sm font-semibold text-[var(--foreground)] tracking-tight">רשימות תפוצה</h1>
          {!state.loading && (
            <span className="text-xs tabular-nums text-[var(--faint)]">סה&quot;כ {state.lists.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => dispatch({ creating: true })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-strong)] rounded-lg transition-colors"
        >
          <Plus className="size-3.5" />
          הוסף רשימה חדשה
        </button>
      </div>

      <div className="p-5 flex-1">
        {state.creating && (
          <div className="mb-4 bg-surface border border-[var(--accent)] rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-[var(--foreground)] mb-2">שם הרשימה</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={state.newName}
                onChange={(e) => dispatch({ newName: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createList();
                  if (e.key === "Escape") cancelCreate();
                }}
                placeholder="למשל: לידים חמים Q2"
                aria-label="שם הרשימה החדשה"
                className="flex-1 text-sm px-3 py-2 border border-[var(--line)] rounded-lg outline-none focus:border-[var(--accent)] bg-[var(--background)] placeholder:text-[var(--faint)]"
              />
              <button
                type="button"
                onClick={createList}
                disabled={state.saving || !state.newName.trim()}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:opacity-50 rounded-lg transition-colors"
              >
                {state.saving ? <Loader2 className="size-3.5 animate-spin" /> : "צור"}
              </button>
              <button
                type="button"
                onClick={cancelCreate}
                aria-label="בטל יצירת רשימה"
                className="p-2 text-[var(--faint)] hover:text-[var(--muted)] transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        {state.loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 text-[var(--faint)] animate-spin" />
          </div>
        ) : state.lists.length === 0 && !state.creating ? (
          <EmptyState
            icon={BookMarked}
            title="עוד אין רשימות תפוצה"
            reason="רשימה נוצרת מתוך אנשי הקשר — בוחרים כמה אנשים ושומרים אותם יחד."
            next="אחרי שתהיה רשימה, אפשר להריץ עליה קמפיין."
            action={
              <Link
                href="/contacts"
                className="fv-ring inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
              >
                לבחירת אנשי קשר
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {state.lists.map((list) => (
              <div
                key={list.id}
                className="bg-surface border border-[var(--line)] rounded-xl p-4 hover:border-[var(--faint)] transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/lists/${list.id}`}
                    className="flex-1 min-w-0"
                  >
                    <p className="text-sm font-medium text-[var(--foreground)] truncate group-hover:text-[var(--accent)] transition-colors">
                      {list.name}
                    </p>
                    <p className="text-xs text-[var(--faint)] mt-1 tabular-nums">
                      {list.memberCount} אנשי קשר
                    </p>
                    <p className="text-[10px] text-[var(--faint)] mt-2">
                      {new Date(list.createdAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={() => deleteList(list.id)}
                    disabled={state.deletingId === list.id}
                    aria-label={`מחק רשימה ${list.name}`}
                    className="shrink-0 p-1.5 text-[var(--faint)] hover:text-[var(--danger)] transition-colors opacity-0 group-hover:opacity-100"
                    title="מחק"
                  >
                    {state.deletingId === list.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
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
