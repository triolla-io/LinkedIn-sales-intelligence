"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Check, Loader2, Zap, UserPlus } from "lucide-react";
import Link from "next/link";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import ContactDrawer from "@/components/dashboard/contact-drawer";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import AddContactsToListModal from "@/components/dashboard/add-contacts-to-list-modal";

type ListDetail = { id: string; name: string; memberCount: number; createdAt: string };

type State = {
  list: ListDetail | null;
  contacts: Contact[];
  total: number;
  page: number;
  loading: boolean;
  editingName: boolean;
  nameInput: string;
  savingName: boolean;
  addContactsOpen: boolean;
  selectedIds: Set<string>;
  drawerContact: Contact | null;
  removingId: string | null;
  enriching: boolean;
  enrichProgress: { done: number; target: number } | null;
  enrichDone: boolean;
  enrichError: string | null;
};

const pageSize = 20;

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [state, dispatch] = useReducer(
    (s: State, action: Partial<State>) => ({ ...s, ...action }),
    {
      list: null,
      contacts: [],
      total: 0,
      page: 1,
      loading: true,
      editingName: false,
      nameInput: "",
      savingName: false,
      addContactsOpen: false,
      selectedIds: new Set<string>(),
      drawerContact: null,
      removingId: null,
      enriching: false,
      enrichProgress: null,
      enrichDone: false,
      enrichError: null,
    }
  );

  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => {
    clearTimeout(clearTimerRef.current);
    clearInterval(pollRef.current);
  }, []);

  const fetchList = useCallback(async (pg = state.page) => {
    dispatch({ loading: true, selectedIds: new Set() });
    const res = await fetch(`/api/lists/${id}?page=${pg}&pageSize=${pageSize}`);
    if (!res.ok) { router.push("/lists"); return; }
    const data = await res.json();
    dispatch({ list: data.list, contacts: data.contacts, total: data.total, loading: false });
  }, [id, state.page, router]);

  useEffect(() => { fetchList(state.page); }, [id, state.page, fetchList]);

  async function saveName() {
    if (!state.nameInput.trim() || !state.list) return;
    dispatch({ savingName: true });
    const res = await fetch(`/api/lists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: state.nameInput.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      dispatch({ list: state.list ? { ...state.list, name: data.list.name } : state.list });
    }
    dispatch({ savingName: false, editingName: false });
  }

  async function removeContact(contactId: string) {
    dispatch({ removingId: contactId });
    await fetch(`/api/lists/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: [contactId] }),
    });
    dispatch({
      contacts: state.contacts.filter((c) => c.id !== contactId),
      list: state.list ? { ...state.list, memberCount: state.list.memberCount - 1 } : state.list,
      removingId: null,
    });
  }

  async function enrichList() {
    clearInterval(pollRef.current);
    dispatch({ enriching: true, enrichProgress: null, enrichDone: false, enrichError: null });
    try {
      const statusRes = await fetch(`/api/lists/${id}/enrich`);
      const statusData = await statusRes.json();
      const baseline = statusData.withEmail ?? 0;

      const postRes = await fetch(`/api/lists/${id}/enrich`, { method: "POST" });
      const postData = await postRes.json();
      if (!postRes.ok) {
        dispatch({ enrichError: postData.error === "BUDGET_EXHAUSTED" ? "Budget exhausted" : "Enrichment failed" });
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => dispatch({ enrichError: null }), 4000);
        return;
      }
      const { queued } = postData;
      if (queued === 0) {
        dispatch({ enrichDone: true });
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => dispatch({ enrichDone: false }), 4000);
        return;
      }
      dispatch({ enrichProgress: { done: 0, target: queued } });

      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/lists/${id}/enrich`);
          if (!res.ok) return;
          const { withEmail } = await res.json();
          const done = Math.min(withEmail - baseline, queued);
          dispatch({ enrichProgress: { done, target: queued } });
          if (done >= queued) {
            clearInterval(pollRef.current);
            dispatch({ enrichProgress: null, enrichDone: true });
            fetchList(state.page);
            clearTimeout(clearTimerRef.current);
            clearTimerRef.current = setTimeout(() => dispatch({ enrichDone: false }), 4000);
          }
        } catch { /* ignore poll errors */ }
      }, 3000);
    } catch {
      dispatch({ enrichError: "Network error" });
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => dispatch({ enrichError: null }), 4000);
    } finally {
      dispatch({ enriching: false });
    }
  }

  // Derived value — computed during render instead of stored in state
  const totalPages = Math.ceil(state.total / pageSize) || 1;

  if (!state.list && !state.loading) return null;

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/lists" className="text-[#9b9895] hover:text-[#6b6866] transition-colors">
            <ArrowLeft className="size-4" />
          </Link>
          {state.editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={state.nameInput}
                onChange={(e) => dispatch({ nameInput: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                aria-label="שם הרשימה"
                className="bg-[#f8f7f5] border border-[#1585ff]/60 rounded-md px-2 py-0.5 text-sm text-[#111110] focus:outline-none"
              />
              <button type="button" onClick={saveName} disabled={state.savingName} className="text-[#1585ff] hover:text-[#0a70e0] transition-colors">
                {state.savingName ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-[#111110]">{state.list?.name}</h1>
              <button
                type="button"
                onClick={() => { dispatch({ nameInput: state.list?.name ?? "", editingName: true }); }}
                aria-label="ערוך שם רשימה"
                className="text-[#9b9895] hover:text-[#6b6866] transition-colors"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          )}
          {!state.loading && (
            <span className="text-xs font-mono text-[#9b9895]">{state.total} אנשי קשר ברשימה</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {state.enrichError && (
            <span className="text-xs font-mono text-red-400">{state.enrichError}</span>
          )}
          {state.enrichDone && !state.enrichError && (
            <span className="text-xs font-mono text-emerald-600">Done</span>
          )}
          {state.enrichProgress && (
            <span className="text-xs font-mono text-amber-600 flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              {state.enrichProgress.done} / {state.enrichProgress.target}
            </span>
          )}
          <button
            type="button"
            onClick={() => dispatch({ addContactsOpen: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1585ff] border border-[#1585ff]/30 hover:bg-[#1585ff]/5 hover:border-[#1585ff]/50 rounded-md transition-all"
          >
            <UserPlus className="size-3.5" />
            הוסף אנשי קשר
          </button>
          <button
            type="button"
            onClick={enrichList}
            disabled={state.total === 0 || state.enriching || !!state.enrichProgress}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 border border-amber-300 hover:bg-amber-50 hover:border-amber-400 rounded-md transition-all disabled:opacity-40"
          >
            {state.enriching ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            העשר
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="px-5 pt-4 pb-4 flex flex-col flex-1 min-h-0">
        <ContactTable
          contacts={state.contacts}
          selectedIds={state.selectedIds}
          onToggle={(id) =>
            dispatch({
              selectedIds: (() => {
                const next = new Set(state.selectedIds);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })(),
            })
          }
          onSelectAll={() =>
            dispatch({
              selectedIds: state.contacts.every((c) => state.selectedIds.has(c.id))
                ? new Set()
                : new Set(state.contacts.map((c) => c.id)),
            })
          }
          onOpenDrawer={(contact) => dispatch({ drawerContact: contact })}
          loading={state.loading}
          page={state.page}
          totalPages={totalPages}
          total={state.total}
          pageSize={pageSize}
          onPageChange={(page) => dispatch({ page })}
          extraRowAction={(contact) => (
            <button
              type="button"
              onClick={() => removeContact(contact.id)}
              disabled={state.removingId === contact.id}
              className="text-[10px] text-[#9b9895] hover:text-red-400 transition-colors font-mono"
            >
              {state.removingId === contact.id ? "…" : "הסר"}
            </button>
          )}
        />
      </div>


      <ContactDrawer
        contact={state.drawerContact}
        onClose={() => dispatch({ drawerContact: null })}
        onEnrich={(contactId) =>
          fetch(`/api/contacts/${contactId}/enrich`, { method: "POST" })
            .then(() => fetchList(state.page))
            .catch(() => {})
        }
      />

      <AddContactsToListModal
        open={state.addContactsOpen}
        onClose={() => dispatch({ addContactsOpen: false })}
        listId={id}
        onAdded={(count) => {
          dispatch({
            addContactsOpen: false,
            list: state.list ? { ...state.list, memberCount: state.list.memberCount + count } : state.list,
          });
          fetchList(state.page);
        }}
      />

      {state.selectedIds.size > 0 && (
        <BulkEnrichBar
          selectedIds={Array.from(state.selectedIds)}
          selectedContacts={state.contacts.filter((c) => state.selectedIds.has(c.id))}
          onDone={() => { dispatch({ selectedIds: new Set() }); fetchList(state.page); }}
        />
      )}
    </div>
  );
}
