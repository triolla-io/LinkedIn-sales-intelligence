"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatsBar from "@/components/dashboard/stats-bar";
import FilterSidebar, { type Filters, DEFAULT_FILTERS } from "@/components/dashboard/filter-sidebar";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import ContactDrawer from "@/components/dashboard/contact-drawer";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import BackfillEnrichButton from "@/components/dashboard/backfill-enrich-button";
import { RefreshCw } from "lucide-react";
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
const TABLE_HEADER_H = 37;  // grid header row
const TABLE_FOOTER_H = 41;  // pagination footer
const MIN_PAGE_SIZE = 5;
const DEFAULT_PAGE_SIZE = 15;

function buildContactsUrl(filters: Filters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length) params.set("seniority", filters.seniority.join(","));
  if (filters.function.length) params.set("function", filters.function.join(","));
  if (filters.titleSearch.length) params.set("titleSearch", filters.titleSearch.join(","));
  if (filters.industry.length) params.set("industry", filters.industry.join(","));
  if (filters.companySizeBuckets.length) params.set("companySizeBuckets", filters.companySizeBuckets.join(","));
  if (filters.connectedFrom) params.set("connectedFrom", filters.connectedFrom);
  if (filters.connectedTo) params.set("connectedTo", filters.connectedTo);
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

function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function ContactsContent() {
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
    connectedFrom: searchParams.get("connectedFrom") ?? "",
    connectedTo: searchParams.get("connectedTo") ?? "",
    hasEmail: searchParams.get("hasEmail") === "true" ? true : undefined,
    hasPhone: searchParams.get("hasPhone") === "true" ? true : undefined,
    listId: searchParams.get("listId") ?? undefined,
  }));

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [newThisWeek, setNewThisWeek] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerContact, setDrawerContact] = useState<Contact | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      const rows = Math.max(MIN_PAGE_SIZE, Math.floor((h - TABLE_HEADER_H - TABLE_FOOTER_H) / ROW_HEIGHT));
      setPageSize(rows);
    });
    obs.observe(el);
    return () => obs.disconnect();
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
    if (filters.connectedFrom) params.set("connectedFrom", filters.connectedFrom);
    if (filters.connectedTo) params.set("connectedTo", filters.connectedTo);
    if (filters.hasEmail) params.set("hasEmail", "true");
    if (filters.hasPhone) params.set("hasPhone", "true");
    if (filters.listId) params.set("listId", filters.listId);
    router.replace(`/contacts?${params.toString()}`, { scroll: false });
  }, [filters, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const [contactsRes, insightsRes, weekRes] = await Promise.all([
        fetch(buildContactsUrl(filters, page, pageSize)),
        fetch(buildInsightsUrl(filters)),
        fetch(`/api/contacts?connectedFrom=${sevenDaysAgo()}&limit=1`),
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
      console.error("Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleEnrich(id: string) {
    fetch(`/api/contacts/${id}/enrich`, { method: "POST" }).then(() => fetchData()).catch(() => {});
  }

  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;
  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));

  return (
    <div className="flex h-full min-h-screen bg-[#f6f5f3]">
      {/* Filter Sidebar */}
      <aside className="w-56 shrink-0 sticky top-0 h-screen overflow-y-auto">
        <FilterSidebar filters={filters} onChange={setFilters} />
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-[#111110] tracking-tight">Contacts</h1>
            {!loading && (
              <span className="text-xs font-mono text-[#9b9895]">
                {total.toLocaleString()} total
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <BackfillEnrichButton />
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#6b6866] hover:text-[#111110] border border-[#e5e3df] hover:border-[#9b9895] rounded-md transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 pb-0 flex flex-col flex-1 min-h-0 gap-4">
          {/* Stats strip */}
          {insights && (
            <StatsBar
              insights={insights}
              newThisWeek={newThisWeek}
              onFilterCLevel={() =>
                setFilters((prev) => ({ ...prev, seniority: ["C_LEVEL"] }))
              }
            />
          )}

          {/* Table — takes remaining height, no scroll */}
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

      {/* Contact drawer */}
      <ContactDrawer
        contact={drawerContact}
        onClose={() => setDrawerContact(null)}
        onEnrich={handleEnrich}
      />

      {/* Bulk action bar */}
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

export default function ContactsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f6f5f3] flex items-center justify-center">
        <p className="text-xs font-mono text-[#9b9895]">Loading…</p>
      </div>
    }>
      <ContactsContent />
    </Suspense>
  );
}
