"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Megaphone, Pencil, Check, Loader2, Zap } from "lucide-react";
import Link from "next/link";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
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
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{ queued: number; skipped: number; creditsRemaining: number } | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(clearTimerRef.current), []);

  const fetchList = useCallback(async (pg = page) => {
    setLoading(true);
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
    setEnriching(true);
    setEnrichResult(null);
    setEnrichError(null);
    try {
      const res = await fetch(`/api/lists/${id}/enrich`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setEnrichError(data.error === "BUDGET_EXHAUSTED" ? "Budget exhausted" : "Enrichment failed");
      } else {
        setEnrichResult(data);
      }
    } catch {
      setEnrichError("Network error");
    } finally {
      setEnriching(false);
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => { setEnrichResult(null); setEnrichError(null); }, 4000);
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
          {(enrichResult || enrichError) && (
            <span className={`text-xs font-mono ${enrichError ? "text-red-400" : "text-emerald-600"}`}>
              {enrichError
                ? enrichError
                : enrichResult
                ? enrichResult.queued === 0 ? "All enriched" : `${enrichResult.queued} queued`
                : null}
            </span>
          )}
          <button
            onClick={enrichList}
            disabled={total === 0 || enriching}
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
          selectedIds={new Set()}
          onToggle={() => {}}
          onSelectAll={() => {}}
          onOpenDrawer={() => {}}
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
    </div>
  );
}
