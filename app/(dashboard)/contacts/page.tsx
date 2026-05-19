"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatsBar from "@/components/dashboard/stats-bar";
import FilterSidebar, { type Filters, DEFAULT_FILTERS } from "@/components/dashboard/filter-sidebar";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import ContactDrawer from "@/components/dashboard/contact-drawer";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import ComposeModal from "@/components/dashboard/compose-modal";
import BackfillEnrichButton from "@/components/dashboard/backfill-enrich-button";
import EnrichBanner from "@/components/dashboard/enrich-banner";
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

function buildContactsUrl(filters: Filters, cursor?: string) {
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
  }));

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [newThisWeek, setNewThisWeek] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [composeContact, setComposeContact] = useState<Contact | null>(null);
  const [drawerContact, setDrawerContact] = useState<Contact | null>(null);
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

  // Sync URL params when filters change
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
    router.replace(`/contacts?${params.toString()}`, { scroll: false });
  }, [filters, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const [contactsRes, insightsRes, weekRes] = await Promise.all([
        fetch(buildContactsUrl(filters)),
        fetch(buildInsightsUrl(filters)),
        fetch(`/api/contacts?connectedFrom=${sevenDaysAgo()}&limit=1`),
      ]);
      if (contactsRes.ok) {
        const data = await contactsRes.json();
        setContacts(data.items ?? []);
        setNextCursor(data.nextCursor ?? null);
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

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));

  return (
    <div className="flex h-full min-h-screen bg-[#0f1e2e]">
      {/* Filter Sidebar */}
      <aside className="w-56 shrink-0 sticky top-0 h-screen overflow-y-auto">
        <FilterSidebar filters={filters} onChange={setFilters} />
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <EnrichBanner />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1e3248] bg-[#162333] sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-[#eaf2fd] tracking-tight">Contacts</h1>
            {!loading && (
              <span className="text-xs font-mono text-[#456078]">
                {contacts.length.toLocaleString()} shown
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <BackfillEnrichButton />
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#5c7d9e] hover:text-[#7a9aba] border border-[#1e3248] hover:border-[#25405e] rounded-md transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              Refresh
            </button>
            <button
              onClick={triggerSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-[#1585ff] hover:bg-[#3090ff] rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
              {syncDone ? "Sync queued!" : syncing ? "Starting…" : "Sync LinkedIn"}
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 flex-1 flex flex-col">
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
            onMessage={setComposeContact}
            onOpenDrawer={setDrawerContact}
            loading={loading}
            onLoadMore={loadMore}
            hasMore={!!nextCursor}
            loadingMore={loadingMore}
          />
        </div>
      </div>

      {/* Contact drawer */}
      <ContactDrawer
        contact={drawerContact}
        onClose={() => setDrawerContact(null)}
        onEnrich={handleEnrich}
        onMessage={(c) => { setComposeContact(c); setDrawerContact(null); }}
      />

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkEnrichBar
          selectedIds={Array.from(selectedIds)}
          selectedContacts={selectedContacts}
          onDone={() => { setSelectedIds(new Set()); fetchData(); }}
          onMessage={(c) => { setComposeContact(c); setSelectedIds(new Set()); }}
        />
      )}

      {/* Compose modal */}
      {composeContact && (
        <ComposeModal contact={composeContact} onClose={() => setComposeContact(null)} />
      )}
    </div>
  );
}

export default function ContactsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0f1e2e] flex items-center justify-center">
        <p className="text-xs font-mono text-[#456078]">Loading…</p>
      </div>
    }>
      <ContactsContent />
    </Suspense>
  );
}
