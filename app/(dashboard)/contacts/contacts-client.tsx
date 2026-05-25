"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import StatsBar from "@/components/dashboard/stats-bar";
import FilterSidebar, { type Filters, DEFAULT_FILTERS } from "@/components/dashboard/filter-sidebar";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import ContactDrawer from "@/components/dashboard/contact-drawer";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import { RefreshCw, Download } from "lucide-react";
import { cn } from "@/lib/cn";

type InsightsData = {
  total: number;
  bySeniority: Record<string, number>;
  byFunction: Record<string, number>;
  topCompanies: { name: string; count: number }[];
  companySizeHistogram: { bucket: string; count: number }[];
  coverage: { email: number; phone: number };
};

const ROW_HEIGHT = 56;
const TABLE_HEADER_H = 37;
const TABLE_FOOTER_H = 41;
const MIN_PAGE_SIZE = 5;
export const DEFAULT_PAGE_SIZE = 15;

function buildContactsUrl(filters: Filters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length) params.set("seniority", filters.seniority.join(","));
  if (filters.function.length) params.set("function", filters.function.join(","));
  if (filters.titleSearch.length) params.set("titleSearch", filters.titleSearch.join(","));
  if (filters.industry.length) params.set("industry", filters.industry.join(","));
  if (filters.companySizeBuckets.length) params.set("companySizeBuckets", filters.companySizeBuckets.join(","));
  if (filters.hasEmail) params.set("hasEmail", "true");
  if (filters.hasPhone) params.set("hasPhone", "true");
  if (filters.listId) params.set("listId", filters.listId);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `/api/contacts?${params.toString()}`;
}

function buildInsightsUrl(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length) params.set("seniority", filters.seniority.join(","));
  if (filters.function.length) params.set("function", filters.function.join(","));
  return `/api/insights?${params.toString()}`;
}

function buildExportUrl(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length) params.set("seniority", filters.seniority.join(","));
  if (filters.function.length) params.set("function", filters.function.join(","));
  if (filters.titleSearch.length) params.set("titleSearch", filters.titleSearch.join(","));
  if (filters.industry.length) params.set("industry", filters.industry.join(","));
  if (filters.companySizeBuckets.length) params.set("companySizeBuckets", filters.companySizeBuckets.join(","));
  if (filters.hasEmail) params.set("hasEmail", "true");
  if (filters.hasPhone) params.set("hasPhone", "true");
  if (filters.listId) params.set("listId", filters.listId);
  return `/api/contacts/export?${params.toString()}`;
}

function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

interface ContactsClientProps {
  initialContacts: Contact[];
  initialTotal: number;
}

export default function ContactsClient({ initialContacts, initialTotal }: ContactsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    q: searchParams.get("q") ?? "",
    seniority: searchParams.get("seniority")?.split(",").filter(Boolean) ?? [],
    function: searchParams.get("function")?.split(",").filter(Boolean) ?? [],
    titleSearch: searchParams.get("titleSearch")?.split(",").filter(Boolean) ?? [],
    industry: searchParams.get("industry")?.split(",").filter(Boolean) ?? [],
    companySizeBuckets: searchParams.get("companySizeBuckets")?.split(",").filter(Boolean) ?? [],
    hasEmail: searchParams.get("hasEmail") === "true" ? true : undefined,
    hasPhone: searchParams.get("hasPhone") === "true" ? true : undefined,
    listId: searchParams.get("listId") ?? undefined,
  }));

  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(initialTotal);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [newThisWeek, setNewThisWeek] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerContact, setDrawerContact] = useState<Contact | null>(null);

  const tableWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const obs = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const h = entry.contentRect.height;
        const rows = Math.max(MIN_PAGE_SIZE, Math.floor((h - TABLE_HEADER_H - TABLE_FOOTER_H) / ROW_HEIGHT));
        setPageSize(rows);
      }, 100);
    });
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(timer); };
  }, []);

  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      prevFiltersRef.current = filters;
      setPage(1);
    }
  }, [filters]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.seniority.length) params.set("seniority", filters.seniority.join(","));
    if (filters.function.length) params.set("function", filters.function.join(","));
    if (filters.titleSearch.length) params.set("titleSearch", filters.titleSearch.join(","));
    if (filters.industry.length) params.set("industry", filters.industry.join(","));
    if (filters.companySizeBuckets.length) params.set("companySizeBuckets", filters.companySizeBuckets.join(","));
    if (filters.hasEmail) params.set("hasEmail", "true");
    if (filters.hasPhone) params.set("hasPhone", "true");
    if (filters.listId) params.set("listId", filters.listId);
    router.replace(`/contacts?${params.toString()}`, { scroll: false });
  }, [filters, router]);

  const abortRef = useRef<AbortController | null>(null);
  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setSelectedIds(new Set());
    try {
      const [contactsRes, insightsRes, weekRes] = await Promise.all([
        fetch(buildContactsUrl(filters, page, pageSize), { signal }),
        fetch(buildInsightsUrl(filters), { signal }),
        fetch(`/api/contacts?connectedFrom=${sevenDaysAgo()}&limit=1`, { signal }),
      ]);
      if (contactsRes.ok) {
        const data = await contactsRes.json();
        setContacts(data.items ?? []);
        setTotal(data.totalApprox ?? 0);
      }
      if (insightsRes.ok) setInsights(await insightsRes.json());
      if (weekRes.ok) {
        const weekData = await weekRes.json();
        setNewThisWeek(weekData.totalApprox ?? 0);
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      console.error("Failed to fetch data:", e);
    }
  }, [filters, page, pageSize]);

  useAutoRefresh(fetchData, 30_000);

  // Re-fetch when filters, page, or pageSize change
  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    fetchData();
  }, [fetchData]);

  function handleEnrich(id: string) {
    fetch(`/api/contacts/${id}/enrich`, { method: "POST" }).then(() => fetchData()).catch(() => {});
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(buildExportUrl(filters), { cache: "no-store" });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;
  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));

  return (
    <div className="flex h-full min-h-screen bg-[#f6f5f3]">
      <aside className="shrink-0 sticky top-0 h-screen">
        <FilterSidebar filters={filters} onChange={setFilters} />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-[#111110] tracking-tight">אנשי קשר</h1>
            <span className="text-xs font-mono text-[#9b9895]">
              {total.toLocaleString()} סה"כ
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-600 border border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className={cn("w-3.5 h-3.5", exporting && "animate-bounce")} />
              {exporting ? "מייצא…" : "ייצוא"}
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#6b6866] hover:text-[#111110] border border-[#e5e3df] hover:border-[#9b9895] rounded-md transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              רענן
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 pb-0 flex flex-col flex-1 min-h-0 gap-4">
          {insights && (
            <StatsBar
              insights={insights}
              newThisWeek={newThisWeek}
              onFilterCLevel={() =>
                setFilters((prev) => ({ ...prev, seniority: ["C_LEVEL"] }))
              }
            />
          )}

          <div ref={tableWrapperRef} className="flex-1 min-h-0 flex flex-col pb-4">
            <ContactTable
              contacts={contacts}
              selectedIds={selectedIds}
              onToggle={(id) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return next;
                })
              }
              onSelectAll={() =>
                setSelectedIds(
                  contacts.every((c) => selectedIds.has(c.id))
                    ? new Set()
                    : new Set(contacts.map((c) => c.id))
                )
              }
              onEnrich={handleEnrich}
              onOpenDrawer={setDrawerContact}
              loading={loading}
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        </div>
      </div>

      <ContactDrawer
        contact={drawerContact}
        onClose={() => setDrawerContact(null)}
        onEnrich={handleEnrich}
        onSaved={(updated) => {
          setDrawerContact(updated);
          setContacts((prev) => prev.map((c) => c.id === updated.id ? updated : c));
        }}
      />

      {selectedIds.size > 0 && (
        <BulkEnrichBar
          selectedIds={Array.from(selectedIds)}
          selectedContacts={selectedContacts}
          onDone={() => { setSelectedIds(new Set()); fetchData(); }}
        />
      )}
    </div>
  );
}
