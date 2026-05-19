"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InsightTiles from "@/components/dashboard/insight-tiles";
import FilterSidebar, { type Filters, DEFAULT_FILTERS } from "@/components/dashboard/filter-sidebar";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import ComposeModal from "@/components/dashboard/compose-modal";
import { RefreshCw } from "lucide-react";

type InsightsData = {
  total: number;
  bySeniority: Record<string, number>;
  byFunction: Record<string, number>;
  topCompanies: { name: string; count: number }[];
  companySizeHistogram: { bucket: string; count: number }[];
  coverage: { email: number; phone: number };
};

function buildContactsUrl(filters: Filters, cursor?: string) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length) params.set("seniority", filters.seniority.join(","));
  if (filters.function.length) params.set("function", filters.function.join(","));
  if (filters.titleSearch.length) params.set("titleSearch", filters.titleSearch.join(","));
  if (filters.industry.length) params.set("industry", filters.industry.join(","));
  if (filters.companySizeBuckets.length) params.set("companySizeBuckets", filters.companySizeBuckets.join(","));
  if (filters.hasEmail) params.set("hasEmail", "true");
  if (filters.hasPhone) params.set("hasPhone", "true");
  if (cursor) params.set("cursor", cursor);
  return `/api/contacts?${params.toString()}`;
}

function buildInsightsUrl(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.seniority.length) params.set("seniority", filters.seniority.join(","));
  if (filters.function.length) params.set("function", filters.function.join(","));
  return `/api/insights?${params.toString()}`;
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
    hasEmail: searchParams.get("hasEmail") === "true" ? true : undefined,
    hasPhone: searchParams.get("hasPhone") === "true" ? true : undefined,
  }));

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [composeContact, setComposeContact] = useState<Contact | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  async function triggerSync() {
    setSyncing(true);
    setSyncDone(false);
    try {
      await fetch("/api/sync/trigger", { method: "POST" });
      setSyncDone(true);
      setTimeout(() => setSyncDone(false), 3000);
    } catch (e) {
      console.error("Sync trigger failed:", e);
    } finally {
      setSyncing(false);
    }
  }

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
    router.replace(`/contacts?${params.toString()}`, { scroll: false });
  }, [filters, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const [contactsRes, insightsRes] = await Promise.all([
        fetch(buildContactsUrl(filters)),
        fetch(buildInsightsUrl(filters)),
      ]);
      if (contactsRes.ok) {
        const data = await contactsRes.json();
        setContacts(data.items ?? []);
        setNextCursor(data.nextCursor ?? null);
      }
      if (insightsRes.ok) setInsights(await insightsRes.json());
    } catch (e) {
      console.error("Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildContactsUrl(filters, nextCursor));
      if (res.ok) {
        const data = await res.json();
        setContacts((prev) => [...prev, ...(data.items ?? [])]);
        setNextCursor(data.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function handleEnrich(id: string) {
    fetch(`/api/contacts/${id}/enrich`, { method: "POST" }).then(() => fetchData()).catch(() => {});
  }

  return (
    <div className="flex h-full min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-gray-200">
        <FilterSidebar filters={filters} onChange={setFilters} />
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white sticky top-0 z-10">
          <h1 className="text-xl font-semibold text-gray-900">
            Contacts
            {!loading && <span className="ml-2 text-sm font-normal text-gray-400">{contacts.length} shown</span>}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerSync}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncDone ? "Sync started!" : syncing ? "Starting…" : "Sync LinkedIn"}
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 flex-1">
          {insights && (
            <InsightTiles
              insights={insights}
              onApplyFilter={(delta) =>
                setFilters((prev) => ({
                  ...prev,
                  seniority: delta.seniority ?? prev.seniority,
                  function: delta.function ?? prev.function,
                }))
              }
            />
          )}

          <ContactTable
            contacts={contacts}
            selectedIds={selectedIds}
            onToggle={(id) => setSelectedIds((prev) => {
              const next = new Set(prev);
              next.has(id) ? next.delete(id) : next.add(id);
              return next;
            })}
            onSelectAll={() =>
              setSelectedIds(
                contacts.every((c) => selectedIds.has(c.id))
                  ? new Set()
                  : new Set(contacts.map((c) => c.id))
              )
            }
            onEnrich={handleEnrich}
            onMessage={setComposeContact}
            loading={loading}
          />

          {nextCursor && (
            <div className="flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 transition-colors"
              >
                {loadingMore && <RefreshCw className="w-4 h-4 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <BulkEnrichBar
          selectedIds={Array.from(selectedIds)}
          onDone={() => { setSelectedIds(new Set()); fetchData(); }}
        />
      )}

      {composeContact && (
        <ComposeModal contact={composeContact} onClose={() => setComposeContact(null)} />
      )}
    </div>
  );
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">Loading…</div>}>
      <ContactsContent />
    </Suspense>
  );
}
