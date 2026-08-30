"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Check, Loader2, Zap, UserPlus, UserMinus } from "lucide-react";
import Link from "next/link";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import ContactDrawer from "@/components/dashboard/contact-drawer";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import AddContactsToListModal from "@/components/dashboard/add-contacts-to-list-modal";
import { runBatchEnrichment, enrichmentProgress } from "@/lib/enrichment-progress";
import { toast } from "@/lib/toast";

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
      enrichError: null,
    }
  );

  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    clearTimeout(clearTimerRef.current);
  }, []);

  const [jobActive, setJobActive] = useState(false);
  useEffect(() => enrichmentProgress.subscribe((s) => setJobActive(s.job !== null)), []);

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

  async function removeFromList(contactId: string) {
    dispatch({ removingId: contactId });
    // Remove from THIS list only — the contact stays in the system and in any
    // other lists it belongs to.
    await fetch(`/api/lists/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: [contactId] }),
    });
    dispatch({
      contacts: state.contacts.filter((c) => c.id !== contactId),
      total: state.total - 1,
      list: state.list ? { ...state.list, memberCount: state.list.memberCount - 1 } : state.list,
      removingId: null,
    });
  }

  async function enrichList() {
    dispatch({ enriching: true, enrichError: null });
    const since = new Date().toISOString();
    try {
      const postRes = await fetch(`/api/lists/${id}/enrich`, { method: "POST" });
      const postData = await postRes.json();
      if (!postRes.ok) {
        dispatch({ enrichError: postData.error === "BUDGET_EXHAUSTED" ? "Budget exhausted" : "Enrichment failed" });
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => dispatch({ enrichError: null }), 4000);
        return;
      }
      const { queued, shared, skipped, creditsRemaining, contactIds } = postData as {
        queued: number;
        shared: number;
        skipped: number;
        creditsRemaining: number;
        contactIds: string[];
      };
      if (queued > 0) {
        void runBatchEnrichment({
          kind: "list",
          label: `מעשיר ${queued} אנשי קשר`,
          total: queued,
          contactIds: contactIds ?? [],
          since,
          skipped,
          shared,
          creditsRemaining,
        }).then(() => fetchList(state.page));
      } else {
        toast.info("אין אנשי קשר חדשים להעשרה", shared > 0 ? `${shared} עודכנו משיתוף` : undefined);
        fetchList(state.page);
      }
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
    <div className="flex flex-col h-full min-h-screen bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--line)] bg-surface sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/lists" className="text-[var(--faint)] hover:text-[var(--muted)] transition-colors">
            <ArrowLeft className="size-4" />
          </Link>
          {state.editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={state.nameInput}
                onChange={(e) => dispatch({ nameInput: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                aria-label="שם הרשימה"
                className="bg-[var(--surface-secondary)] border border-[var(--accent)]/60 rounded-md px-2 py-0.5 text-sm text-[var(--foreground)] focus:outline-none"
              />
              <button type="button" onClick={saveName} disabled={state.savingName} aria-label="שמור שם" className="text-[var(--accent)] hover:text-[var(--accent-strong)] transition-colors">
                {state.savingName ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-[var(--foreground)]">{state.list?.name}</h1>
              <button
                type="button"
                onClick={() => { dispatch({ nameInput: state.list?.name ?? "", editingName: true }); }}
                aria-label="ערוך שם רשימה"
                className="text-[var(--faint)] hover:text-[var(--muted)] transition-colors"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          )}
          {!state.loading && (
            <span className="text-xs tabular-nums text-[var(--faint)]">{state.total} אנשי קשר ברשימה</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {state.enrichError && (
            <span className="text-xs font-mono text-[var(--danger)]">{state.enrichError}</span>
          )}
          <button
            type="button"
            onClick={() => dispatch({ addContactsOpen: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 hover:border-[var(--accent)]/50 rounded-md transition-all"
          >
            <UserPlus className="size-3.5" />
            הוסף אנשי קשר
          </button>
          <button
            type="button"
            onClick={enrichList}
            disabled={state.total === 0 || state.enriching || jobActive}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--warning)] border border-[var(--warning)]/30 hover:bg-[var(--warning-soft)] hover:border-[var(--warning)] rounded-md transition-all disabled:opacity-40"
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
              onClick={() => removeFromList(contact.id)}
              disabled={state.removingId === contact.id}
              aria-label={`הסר את ${contact.fullName} מהרשימה`}
              title="הסר מהרשימה"
              className="p-1.5 text-[var(--faint)] hover:text-[var(--danger)] transition-colors disabled:opacity-40"
            >
              {state.removingId === contact.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <UserMinus className="size-3.5" />
              )}
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
