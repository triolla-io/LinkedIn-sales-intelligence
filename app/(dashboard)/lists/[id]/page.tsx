"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Megaphone, Pencil, Check, Loader2, Zap } from "lucide-react";
import Link from "next/link";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import ContactDrawer from "@/components/dashboard/contact-drawer";
import BulkEnrichBar from "@/components/dashboard/bulk-enrich-bar";
import { NewCampaignModal } from "@/components/dashboard/new-campaign-modal";

type ListDetail = { id: string; name: string; memberCount: number; createdAt: string };

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [list, setList] = useState<ListDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerContact, setDrawerContact] = useState<Contact | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; target: number } | null>(null);
  const [enrichDone, setEnrichDone] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => {
    clearTimeout(clearTimerRef.current);
    clearInterval(pollRef.current);
  }, []);

  const fetchList = useCallback(async (pg = page) => {
    setLoading(true);
    setSelectedIds(new Set());
    const res = await fetch(`/api/lists/${id}?page=${pg}&pageSize=${pageSize}`);
    if (!res.ok) { router.push("/lists"); return; }
    const data = await res.json();
    setList(data.list);
    setContacts(data.contacts);
    setTotal(data.total);
    setLoading(false);
  }, [id, page, router]);

  useEffect(() => { fetchList(page); }, [id, page, fetchList]);

  async function saveName() {
    if (!nameInput.trim() || !list) return;
    setSavingName(true);
    const res = await fetch(`/api/lists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setList((prev) => prev ? { ...prev, name: data.list.name } : prev);
    }
    setSavingName(false);
    setEditingName(false);
  }

  async function removeContact(contactId: string) {
    setRemovingId(contactId);
    await fetch(`/api/lists/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: [contactId] }),
    });
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    setList((prev) => prev ? { ...prev, memberCount: prev.memberCount - 1 } : prev);
    setRemovingId(null);
  }

  async function enrichList() {
    clearInterval(pollRef.current);
    setEnriching(true);
    setEnrichProgress(null);
    setEnrichDone(false);
    setEnrichError(null);
    try {
      const statusRes = await fetch(`/api/lists/${id}/enrich`);
      const statusData = await statusRes.json();
      const baseline = statusData.withEmail ?? 0;

      const postRes = await fetch(`/api/lists/${id}/enrich`, { method: "POST" });
      const postData = await postRes.json();
      if (!postRes.ok) {
        setEnrichError(postData.error === "BUDGET_EXHAUSTED" ? "Budget exhausted" : "Enrichment failed");
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setEnrichError(null), 4000);
        return;
      }
      const { queued } = postData;
      if (queued === 0) {
        setEnrichDone(true);
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setEnrichDone(false), 4000);
        return;
      }
      setEnrichProgress({ done: 0, target: queued });

      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/lists/${id}/enrich`);
          if (!res.ok) return;
          const { withEmail } = await res.json();
          const done = Math.min(withEmail - baseline, queued);
          setEnrichProgress({ done, target: queued });
          if (done >= queued) {
            clearInterval(pollRef.current);
            setEnrichProgress(null);
            setEnrichDone(true);
            fetchList(page);
            clearTimeout(clearTimerRef.current);
            clearTimerRef.current = setTimeout(() => setEnrichDone(false), 4000);
          }
        } catch { /* ignore poll errors */ }
      }, 3000);
    } catch {
      setEnrichError("Network error");
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setEnrichError(null), 4000);
    } finally {
      setEnriching(false);
    }
  }

  const totalPages = Math.ceil(total / pageSize) || 1;

  if (!list && !loading) return null;

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/lists" className="text-[#9b9895] hover:text-[#6b6866] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                autoFocus
                className="bg-[#f8f7f5] border border-[#1585ff]/60 rounded-md px-2 py-0.5 text-sm text-[#111110] focus:outline-none"
              />
              <button onClick={saveName} disabled={savingName} className="text-[#1585ff] hover:text-[#0a70e0] transition-colors">
                {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-[#111110]">{list?.name}</h1>
              <button
                onClick={() => { setNameInput(list?.name ?? ""); setEditingName(true); }}
                className="text-[#9b9895] hover:text-[#6b6866] transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}
          {!loading && (
            <span className="text-xs font-mono text-[#9b9895]">{total} contacts</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {enrichError && (
            <span className="text-xs font-mono text-red-400">{enrichError}</span>
          )}
          {enrichDone && !enrichError && (
            <span className="text-xs font-mono text-emerald-600">Done</span>
          )}
          {enrichProgress && (
            <span className="text-xs font-mono text-amber-600 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {enrichProgress.done} / {enrichProgress.target}
            </span>
          )}
          <button
            onClick={enrichList}
            disabled={total === 0 || enriching || !!enrichProgress}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 border border-amber-300 hover:bg-amber-50 hover:border-amber-400 rounded-md transition-all disabled:opacity-40"
          >
            {enriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Enrich
          </button>
          <button
            onClick={() => setCampaignOpen(true)}
            disabled={total === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1585ff] border border-[#1585ff]/30 hover:bg-[#1585ff]/5 hover:border-[#1585ff]/50 rounded-md transition-all disabled:opacity-40"
          >
            <Megaphone className="w-3.5 h-3.5" />
            Launch Campaign
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="px-5 pt-4 pb-4 flex flex-col flex-1 min-h-0">
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
          onOpenDrawer={setDrawerContact}
          loading={loading}
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          extraRowAction={(contact) => (
            <button
              onClick={() => removeContact(contact.id)}
              disabled={removingId === contact.id}
              className="text-[10px] text-[#9b9895] hover:text-red-400 transition-colors font-mono"
            >
              {removingId === contact.id ? "…" : "Remove"}
            </button>
          )}
        />
      </div>

      <NewCampaignModal
        open={campaignOpen}
        onClose={() => setCampaignOpen(false)}
        contactIds={contacts.map((c) => c.id)}
      />

      <ContactDrawer
        contact={drawerContact}
        onClose={() => setDrawerContact(null)}
        onEnrich={(contactId) =>
          fetch(`/api/contacts/${contactId}/enrich`, { method: "POST" })
            .then(() => fetchList(page))
            .catch(() => {})
        }
      />

      {selectedIds.size > 0 && (
        <BulkEnrichBar
          selectedIds={Array.from(selectedIds)}
          selectedContacts={contacts.filter((c) => selectedIds.has(c.id))}
          onDone={() => { setSelectedIds(new Set()); fetchList(page); }}
        />
      )}
    </div>
  );
}
