"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Wifi, WifiOff, AlertCircle, Users, Shield, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";

type LinkedinStatus = "ACTIVE" | "EXPIRED" | "DISCONNECTED";
type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  linkedinStatus: LinkedinStatus;
  lastValidatedAt: string | null;
  contactCount: number;
  lastSyncedAt: string | null;
  creditsConsumed: number;
};

function StatusBadge({ status }: { status: LinkedinStatus }) {
  const cfg = {
    ACTIVE: { label: "Active", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", Icon: Wifi },
    EXPIRED: { label: "Expired", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20", Icon: AlertCircle },
    DISCONNECTED: { label: "Disconnected", cls: "text-[#5c7d9e] bg-[#14223a] border-[#25405e]", Icon: WifiOff },
  }[status];

  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium", cfg.cls)}>
      <cfg.Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

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

  const activeCount = users.filter((u) => u.linkedinStatus === "ACTIVE").length;

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
    <div className="min-h-full bg-[#0f1e2e] p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest mb-1">Admin</p>
          <h1 className="text-2xl font-semibold text-[#eaf2fd]">Team Overview</h1>
          <p className="text-[#5c7d9e] text-sm mt-1">
            {loading ? "Loading…" : `${users.length} salespeople · ${activeCount} LinkedIn active`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {impersonating && (
            <button
              onClick={stopImpersonation}
              disabled={actionLoading === "stop"}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Stop impersonating
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-[#25405e] text-[#5c7d9e] hover:text-[#9ecfff] hover:border-[#1585ff]/30 transition-all"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {impersonating && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <LogIn className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">
            You are viewing as <strong>{users.find(u => u.id === impersonating)?.name ?? "…"}</strong>.
            All contacts and actions are scoped to their account.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-[#25405e] bg-[#1a2d3f] overflow-hidden">
        {/* Table header */}
        <div
          className="grid items-center gap-4 px-5 py-3 border-b border-[#25405e] bg-[#0a1420]"
          style={{ gridTemplateColumns: "1fr 140px 90px 130px 80px 130px 120px" }}
        >
          {["Salesperson", "LinkedIn", "Contacts", "Last Synced", "Role", "Validated", ""].map((h) => (
            <span key={h} className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest">{h}</span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-[#5c7d9e] animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Users className="w-8 h-8 text-[#25405e]" />
            <p className="text-sm text-[#5c7d9e]">No team members found.</p>
          </div>
        ) : (
          users.map((u, idx) => {
            const isCurrentImpersonation = impersonating === u.id;
            return (
              <div
                key={u.id}
                className={cn(
                  "grid items-center gap-4 px-5 py-3.5 border-b border-[#25405e]/60 last:border-0 transition-colors",
                  isCurrentImpersonation
                    ? "bg-amber-500/5 border-l-2 border-l-amber-500/40"
                    : idx % 2 === 0 ? "hover:bg-[#0f1f30]" : "bg-[#0d1828]/40 hover:bg-[#0f1f30]"
                )}
                style={{ gridTemplateColumns: "1fr 140px 90px 130px 80px 130px 120px" }}
              >
                {/* Name / email */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#eaf2fd] truncate">{u.name}</p>
                  <p className="text-xs text-[#5c7d9e] truncate">{u.email}</p>
                </div>

                {/* LinkedIn status */}
                <div>
                  <StatusBadge status={u.linkedinStatus} />
                </div>

                {/* Contacts */}
                <p className="text-sm font-mono text-[#9ecfff] tabular-nums">
                  {u.contactCount.toLocaleString()}
                </p>

                {/* Last synced */}
                <p className="text-xs text-[#5c7d9e] font-mono">{formatDate(u.lastSyncedAt)}</p>

                {/* Role */}
                <span className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs",
                  u.role === "ADMIN" || u.role === "SUPER_ADMIN"
                    ? "border-[#1585ff]/30 text-[#1585ff] bg-[#1585ff]/10"
                    : "border-[#25405e] text-[#5c7d9e]"
                )}>
                  {u.role === "ADMIN" || u.role === "SUPER_ADMIN"
                    ? <><Shield className="w-3 h-3" /> Admin</>
                    : "Sales"
                  }
                </span>

                {/* Last validated */}
                <p className="text-xs text-[#5c7d9e] font-mono">{formatDate(u.lastValidatedAt)}</p>

                {/* Send as / impersonate */}
                <div className="flex justify-end">
                  {isCurrentImpersonation ? (
                    <button
                      onClick={stopImpersonation}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all"
                    >
                      <LogOut className="w-3 h-3" />
                      Exit
                    </button>
                  ) : (
                    <button
                      onClick={() => startImpersonation(u.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[#25405e] text-[#5c7d9e] hover:border-[#1585ff]/30 hover:text-[#9ecfff] hover:bg-[#1c3048] transition-all disabled:opacity-40"
                    >
                      {actionLoading === u.id
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <LogIn className="w-3 h-3" />
                      }
                      Send as
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-4 text-xs text-[#456078] font-mono">
        "Send as" lets you browse contacts and send messages on behalf of that salesperson.
        A yellow banner will appear while active.
      </p>
    </div>
  );
}
