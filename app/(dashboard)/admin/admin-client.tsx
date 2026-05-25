"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Users, Shield, LogIn, LogOut, UserPlus, Copy, Check, Mail, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  contactCount: number;
  lastSyncedAt: string | null;
  creditsConsumed: number;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export default function AdminClient() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ url?: string; sent?: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [enriching, setEnriching] = useState(false);
  const [enrichDone, setEnrichDone] = useState(false);

  async function triggerWebEnrich() {
    setEnriching(true);
    setEnrichDone(false);
    try {
      await fetch("/api/admin/enrich-companies", { method: "POST" });
      setEnrichDone(true);
      setTimeout(() => setEnrichDone(false), 4000);
    } finally {
      setEnriching(false);
    }
  }

  async function sendInvite() {
    if (!inviteEmail.includes("@")) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteResult({ error: data.error }); return; }
      setInviteResult(data.inviteUrl ? { url: data.inviteUrl } : { sent: true });
      setInviteEmail("");
    } catch {
      setInviteResult({ error: "Failed to send invite" });
    } finally {
      setInviting(false);
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to load");
      setUsers(await res.json());
    } catch {
      setError("Could not load team data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function startImpersonation(userId: string) {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/admin/impersonate/${userId}`, { method: "POST" });
      if (res.ok) {
        setImpersonating(userId);
        router.push("/contacts");
        router.refresh();
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function stopImpersonation() {
    setActionLoading("stop");
    try {
      await fetch("/api/admin/impersonate", { method: "DELETE" });
      setImpersonating(null);
      router.refresh();
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="min-h-full bg-[#f6f5f3] p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-1">ניהול</p>
          <h1 className="text-2xl font-semibold text-[#111110]">סקירת הצוות</h1>
          <p className="text-[#6b6866] text-sm mt-1">
            {loading ? "טוען…" : `${users.length} איש מכירות`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={triggerWebEnrich}
            disabled={enriching}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-[#e5e3df] text-[#6b6866] hover:border-blue-200 hover:text-[#1585ff] transition-all"
            title="חפש באינטרנט כדי למלא מספרי עובדים וענפים חסרים"
          >
            {enriching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {enrichDone ? "העשרה התחילה!" : enriching ? "מתחיל…" : "העשר חברות"}
          </button>
          {impersonating && (
            <button
              onClick={stopImpersonation}
              disabled={actionLoading === "stop"}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-amber-200 text-amber-600 hover:bg-amber-50 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              הפסק התחזות
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-[#e5e3df] text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-all"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            רענן
          </button>
        </div>
      </div>

      {/* Invite member */}
      <div className="rounded-xl border border-[#e5e3df] bg-white p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="w-4 h-4 text-[#9b9895]" />
          <p className="text-sm font-medium text-[#111110]">הזמן חברת צוות</p>
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => { setInviteEmail(e.target.value); setInviteResult(null); }}
            onKeyDown={(e) => e.key === "Enter" && sendInvite()}
            placeholder="colleague@company.com"
            className="flex-1 px-3 py-2 bg-[#f8f7f5] border border-[#e5e3df] rounded-lg text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/50 focus:ring-1 focus:ring-[#1585ff]/20"
          />
          <button
            onClick={sendInvite}
            disabled={inviting || !inviteEmail.includes("@")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1585ff] hover:bg-[#0a70e0] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-all"
          >
            {inviting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
            {inviting ? "שולח…" : "שלח הזמנה"}
          </button>
        </div>

        {inviteResult?.sent && (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600">
            <Check className="w-3.5 h-3.5" />
            הזמנה נשלחה — הם יקבלו אימייל עם קישור כניסה.
          </div>
        )}

        {inviteResult?.url && (
          <div className="mt-3 p-3 rounded-lg bg-[#f8f7f5] border border-[#e5e3df]">
            <p className="text-xs text-[#6b6866] mb-2">
              <span className="text-amber-600 font-medium">אין מפתח אימייל מוגדר</span> — שתף קישור זה ידנית:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-[#1585ff] truncate font-mono">{inviteResult.url}</code>
              <button
                onClick={() => copyLink(inviteResult.url!)}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#e5e3df] hover:border-[#9b9895] text-xs text-[#6b6866] hover:text-[#111110] transition-all"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "הועתק" : "העתק"}
              </button>
            </div>
          </div>
        )}

        {inviteResult?.error && (
          <p className="mt-2 text-xs text-red-500">{inviteResult.error}</p>
        )}
      </div>

      {impersonating && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200">
          <LogIn className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700">
            אתה צופה כ<strong>{users.find(u => u.id === impersonating)?.name ?? "…"}</strong>.
            כל אנשי הקשר והפעולות מוגבלים לחשבון שלהם.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-[#e5e3df] bg-white overflow-hidden">
        {/* Table header */}
        <div
          className="grid items-center gap-4 px-5 py-3 border-b border-[#e5e3df] bg-[#f8f7f5]"
          style={{ gridTemplateColumns: "1fr 90px 130px 80px 120px" }}
        >
          {["איש מכירות", "אנשי קשר", "סנכרן אחרון", "תפקיד", ""].map((h) => (
            <span key={h} className="text-xs font-mono text-[#9b9895] uppercase tracking-widest">{h}</span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-[#9b9895] animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Users className="w-8 h-8 text-[#d4d0cc]" />
            <p className="text-sm text-[#9b9895]">לא נמצאו חברי צוות.</p>
          </div>
        ) : (
          users.map((u, idx) => {
            const isCurrentImpersonation = impersonating === u.id;
            return (
              <div
                key={u.id}
                className={cn(
                  "grid items-center gap-4 px-5 py-3.5 border-b border-[#e5e3df]/70 last:border-0 transition-colors",
                  isCurrentImpersonation
                    ? "bg-amber-50 border-l-2 border-l-amber-300"
                    : idx % 2 === 0 ? "hover:bg-[#f8f7f5]" : "bg-[#fafaf9] hover:bg-[#f8f7f5]"
                )}
                style={{ gridTemplateColumns: "1fr 90px 130px 80px 120px" }}
              >
                {/* Name / email */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#111110] truncate">{u.name}</p>
                  <p className="text-xs text-[#9b9895] truncate">{u.email}</p>
                </div>

                {/* Contacts */}
                <p className="text-sm font-mono text-[#1585ff] tabular-nums">
                  {u.contactCount.toLocaleString()}
                </p>

                {/* Last synced */}
                <p className="text-xs text-[#9b9895] font-mono">{formatDate(u.lastSyncedAt)}</p>

                {/* Role */}
                <span className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs",
                  u.role === "ADMIN" || u.role === "SUPER_ADMIN"
                    ? "border-blue-200 text-blue-600 bg-blue-50"
                    : "border-[#e5e3df] text-[#6b6866]"
                )}>
                  {u.role === "ADMIN" || u.role === "SUPER_ADMIN"
                    ? <><Shield className="w-3 h-3" /> מנהל</>
                    : "מכירות"
                  }
                </span>

                {/* Send as / impersonate */}
                <div className="flex justify-end">
                  {isCurrentImpersonation ? (
                    <button
                      onClick={stopImpersonation}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-amber-200 text-amber-600 hover:bg-amber-50 transition-all"
                    >
                      <LogOut className="w-3 h-3" />
                      יציאה
                    </button>
                  ) : (
                    <button
                      onClick={() => startImpersonation(u.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[#e5e3df] text-[#6b6866] hover:border-blue-200 hover:text-[#1585ff] hover:bg-[#eff5ff] transition-all disabled:opacity-40"
                    >
                      {actionLoading === u.id
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <LogIn className="w-3 h-3" />
                      }
                      שלח כ
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-4 text-xs text-[#9b9895] font-mono">
        "שלח כ" מאפשר לך לדפדף באנשי קשר ולשלוח הודעות בשם איש המכירות.
        שלט צהוב יופיע כאשר הוא פעיל.
      </p>
    </div>
  );
}
