"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import FilterSidebar, {
  type Filters,
  DEFAULT_FILTERS,
} from "@/components/dashboard/filter-sidebar";
import ContactTable, {
  type Contact,
} from "@/components/dashboard/contact-table";
import ContactDrawer from "@/components/dashboard/contact-drawer";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import CreateContactModal from "@/components/dashboard/create-contact-modal";
import { RefreshCw, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";

const ROW_HEIGHT = 56;
const TABLE_HEADER_H = 37;
const TABLE_FOOTER_H = 41;
const MIN_PAGE_SIZE = 5;
const DEFAULT_PAGE_SIZE = 15;

function buildContactsUrl(filters: Filters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length)
    params.set("seniority", filters.seniority.join(","));
  if (filters.function.length)
    params.set("function", filters.function.join(","));
  if (filters.titleSearch.length)
    params.set("titleSearch", filters.titleSearch.join(","));
  if (filters.industry.length)
    params.set("industry", filters.industry.join(","));
  if (filters.companySizeBuckets.length)
    params.set("companySizeBuckets", filters.companySizeBuckets.join(","));
  if (filters.hasEmail) params.set("hasEmail", "true");
  if (filters.hasPhone) params.set("hasPhone", "true");
  if (filters.listId) params.set("listId", filters.listId);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `/api/contacts?${params.toString()}`;
}

function buildContactIdsUrl(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length)
    params.set("seniority", filters.seniority.join(","));
  if (filters.function.length)
    params.set("function", filters.function.join(","));
  if (filters.titleSearch.length)
    params.set("titleSearch", filters.titleSearch.join(","));
  if (filters.industry.length)
    params.set("industry", filters.industry.join(","));
  if (filters.companySizeBuckets.length)
    params.set("companySizeBuckets", filters.companySizeBuckets.join(","));
  if (filters.hasEmail) params.set("hasEmail", "true");
  if (filters.hasPhone) params.set("hasPhone", "true");
  if (filters.listId) params.set("listId", filters.listId);
  params.set("idsOnly", "true");
  return `/api/contacts?${params.toString()}`;
}


type DataState = {
  contacts: Contact[];
  page: number;
  total: number;
};
type DataAction =
  | { type: "contactsFetched"; contacts: Contact[]; total: number }
  | { type: "pageSet"; page: number }
  | { type: "contactUpdated"; contact: Contact }
  | { type: "contactAdded"; contact: Contact };
function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case "contactsFetched":
      return { ...state, contacts: action.contacts, total: action.total };
    case "pageSet":
      if (state.page === action.page) return state;
      return { ...state, page: action.page };
    case "contactUpdated":
      return { ...state, contacts: state.contacts.map((c) => (c.id === action.contact.id ? action.contact : c)) };
    case "contactAdded":
      return { ...state, contacts: [action.contact, ...state.contacts], total: state.total + 1 };
  }
}

interface ContactsClientProps {
  initialContacts: Contact[];
  initialTotal: number;
  initialFilters: Partial<Filters>;
}

export default function ContactsClient({
  initialContacts,
  initialTotal,
  initialFilters,
}: ContactsClientProps) {
  const router = useRouter();

  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  }));

  const [dataState, dispatchData] = useReducer(dataReducer, {
    contacts: initialContacts,
    page: 1,
    total: initialTotal,
  });
  const { contacts, page, total } = dataState;

  const [fetchState, setFetchState] = useState({ loading: false, applyingCache: false });
  const { loading, applyingCache } = fetchState;

  const [uiState, setUiState] = useState<{
    selectedIds: Set<string>;
    drawerContact: Contact | null;
    showCreateModal: boolean;
  }>({ selectedIds: new Set(), drawerContact: null, showCreateModal: false });
  const { selectedIds, drawerContact, showCreateModal } = uiState;

  const tableWrapperRef = useRef<HTMLDivElement>(null);

  const subscribeResize = useCallback((onStoreChange: () => void) => {
    const el = tableWrapperRef.current;
    if (!el) return () => {};
    let timer: ReturnType<typeof setTimeout>;
    const obs = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(onStoreChange, 100);
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    const el = tableWrapperRef.current;
    if (!el) return DEFAULT_PAGE_SIZE;
    const h = el.getBoundingClientRect().height;
    return Math.max(
      MIN_PAGE_SIZE,
      Math.floor((h - TABLE_HEADER_H - TABLE_FOOTER_H) / ROW_HEIGHT)
    );
  }, []);

  const pageSize = useSyncExternalStore(subscribeResize, getSnapshot, () => DEFAULT_PAGE_SIZE);

  const handleFiltersChange = useCallback((newFilters: Filters) => {
    setFilters(newFilters);
    dispatchData({ type: "pageSet", page: 1 });
    const params = new URLSearchParams();
    if (newFilters.q) params.set("q", newFilters.q);
    if (newFilters.seniority.length)
      params.set("seniority", newFilters.seniority.join(","));
    if (newFilters.function.length)
      params.set("function", newFilters.function.join(","));
    if (newFilters.titleSearch.length)
      params.set("titleSearch", newFilters.titleSearch.join(","));
    if (newFilters.industry.length)
      params.set("industry", newFilters.industry.join(","));
    if (newFilters.companySizeBuckets.length)
      params.set("companySizeBuckets", newFilters.companySizeBuckets.join(","));
    if (newFilters.hasEmail) params.set("hasEmail", "true");
    if (newFilters.hasPhone) params.set("hasPhone", "true");
    if (newFilters.listId) params.set("listId", newFilters.listId);
    router.replace(`/contacts?${params.toString()}`, { scroll: false });
  }, [router]);

  const abortRef = useRef<AbortController | null>(null);
  const fetchDataRef = useRef<() => Promise<void>>(async () => {});

  async function fetchData() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setUiState((prev) => ({ ...prev, selectedIds: new Set() }));
    try {
      const contactsRes = await fetch(buildContactsUrl(filters, page, pageSize), { signal });
      if (contactsRes.ok) {
        const data = await contactsRes.json();
        dispatchData({ type: "contactsFetched", contacts: data.items ?? [], total: data.totalApprox ?? 0 });
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      console.error("Failed to fetch data:", e);
    }
  }

  useEffect(() => {
    fetchDataRef.current = fetchData;
  });

  const stableRefresh = useCallback(() => { fetchDataRef.current(); }, []);
  useAutoRefresh(stableRefresh, 30_000);

  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    fetchDataRef.current();
  }, [filters, page, pageSize]);

  function handleEnrich(_id: string) {
    fetchData();
  }

  async function handleApplyCache() {
    setFetchState((prev) => ({ ...prev, applyingCache: true }));
    try {
      await fetch("/api/contacts/apply-cache", { method: "POST" });
      await fetchData();
    } finally {
      setFetchState((prev) => ({ ...prev, applyingCache: false }));
    }
  }

  // Select-all: when the page isn't already fully selected, pull every matching
  // contact id (all pages, current filters) so the selection spans the whole
  // result set — not just the rows currently rendered.
  async function handleSelectAll() {
    const pageAllSelected =
      contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
    if (pageAllSelected) {
      setUiState((prev) => ({ ...prev, selectedIds: new Set() }));
      return;
    }
    try {
      const res = await fetch(buildContactIdsUrl(filters));
      if (res.ok) {
        const data = await res.json();
        const ids: string[] = data.ids ?? [];
        setUiState((prev) => ({ ...prev, selectedIds: new Set(ids) }));
      }
    } catch (e) {
      console.error("Failed to select all contacts:", e);
    }
  }

  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;
  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));

  return (
    <div dir="ltr" className="flex h-full min-h-screen bg-[var(--background)]">
      <aside dir="rtl" className="shrink-0 sticky top-0 h-screen">
        <FilterSidebar filters={filters} onChange={handleFiltersChange} />
      </aside>
      <div dir="rtl" className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--line)] bg-surface sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-[var(--foreground)] tracking-tight">
              אנשי קשר
            </h1>
            <span className="text-xs tabular-nums text-[var(--faint)]">
              {total.toLocaleString()} סה"כ
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUiState((prev) => ({ ...prev, showCreateModal: true }))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-strong)] rounded-md transition-colors"
            >
              <UserPlus className="size-3.5" />
              הוסף איש קשר
            </button>
            <button
              type="button"
              onClick={handleApplyCache}
              disabled={applyingCache || loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--line)] hover:border-[var(--faint)] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw
                className={cn("size-3.5", (applyingCache || loading) && "animate-spin")}
              />
              {applyingCache ? "טוען…" : "רענן נתונים"}
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 pb-0 flex flex-col flex-1 min-h-0 gap-4">
          <div
            ref={tableWrapperRef}
            className="flex-1 min-h-0 flex flex-col pb-4"
          >
            <ContactTable
              contacts={contacts}
              selectedIds={selectedIds}
              onToggle={(id) =>
                setUiState((prev) => {
                  const next = new Set(prev.selectedIds);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return { ...prev, selectedIds: next };
                })
              }
              onSelectAll={handleSelectAll}
              onEnrich={handleEnrich}
              onOpenDrawer={(c) => setUiState((prev) => ({ ...prev, drawerContact: c }))}
              loading={loading}
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={(p) => dispatchData({ type: "pageSet", page: p })}
            />
          </div>
        </div>
      </div>

      <ContactDrawer
        contact={drawerContact}
        onClose={() => setUiState((prev) => ({ ...prev, drawerContact: null }))}
        onEnrich={handleEnrich}
        onSaved={(updated) => {
          setUiState((prev) => ({ ...prev, drawerContact: updated }));
          dispatchData({ type: "contactUpdated", contact: updated });
        }}
      />

      {selectedIds.size > 0 && (
        <BulkEnrichBar
          selectedIds={Array.from(selectedIds)}
          selectedContacts={selectedContacts}
          onDone={() => {
            setUiState((prev) => ({ ...prev, selectedIds: new Set() }));
            fetchData();
          }}
        />
      )}

      {showCreateModal && (
        <CreateContactModal
          onClose={() => setUiState((prev) => ({ ...prev, showCreateModal: false }))}
          onCreated={(contact) => {
            dispatchData({ type: "contactAdded", contact });
            setUiState((prev) => ({ ...prev, showCreateModal: false }));
          }}
        />
      )}
    </div>
  );
}
