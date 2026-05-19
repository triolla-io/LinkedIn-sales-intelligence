"use client";

import { useState } from "react";
import Link from "next/link";
import {
  RefreshCw,
  Wifi,
  WifiOff,
  AlertCircle,
  Users,
  ArrowRight,
  Terminal,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/cn";

type LinkedinStatus = "ACTIVE" | "EXPIRED" | "DISCONNECTED";
type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PAUSED" | "CANCELLED";

interface Props {
  user: { name: string; email: string; image?: string | null };
  linkedinStatus: LinkedinStatus;
  lastValidated: string | null;
  contactCount: number;
  latestSync: {
    status: JobStatus;
    type: string;
    createdAt: string;
    finishedAt: string | null;
  } | null;
}

const STATUS_CONFIG: Record<
  LinkedinStatus,
  { label: string; color: string; Icon: typeof Wifi; ring: string }
> = {
  ACTIVE: {
    label: "Connected",
    color: "text-emerald-400",
    Icon: Wifi,
    ring: "ring-emerald-500/30 bg-emerald-500/10",
  },
  EXPIRED: {
    label: "Session expired",
    color: "text-amber-400",
    Icon: AlertCircle,
    ring: "ring-amber-500/30 bg-amber-500/10",
  },
  DISCONNECTED: {
    label: "Not connected",
    color: "text-[#5c7d9e]",
    Icon: WifiOff,
    ring: "ring-[#25405e]/60 bg-[#14223a]",
  },
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DashboardClient({
  user,
  linkedinStatus,
  lastValidated,
  contactCount,
  latestSync,
}: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const statusCfg = STATUS_CONFIG[linkedinStatus];
  const StatusIcon = statusCfg.Icon;
  const isConnected = linkedinStatus === "ACTIVE";

  async function triggerSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync/trigger", { method: "POST" });
      if (res.ok) {
        setSyncMsg("Sync queued");
        setTimeout(() => setSyncMsg(null), 4000);
      }
    } catch {
      setSyncMsg("Failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-h-full bg-[#0f1e2e] p-8">
      {/* Header greeting */}
      <div className="mb-10">
        <p className="text-[#5c7d9e] text-sm font-mono tracking-widest uppercase mb-1">
          Dashboard
        </p>
        <h1 className="text-2xl font-semibold text-[#eaf2fd]">
          Good to see you, {user.name.split(" ")[0]}.
        </h1>
        <p className="text-[#5c7d9e] text-sm mt-1">{user.email}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LinkedIn Status card */}
        <div className="lg:col-span-2 rounded-xl border border-[#25405e] bg-[#1a2d3f] p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest mb-1">
                LinkedIn Connection
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full ring-1",
                    statusCfg.ring
                  )}
                >
                  <StatusIcon className={cn("w-4 h-4", statusCfg.color)} />
                </span>
                <span className={cn("text-base font-semibold", statusCfg.color)}>
                  {statusCfg.label}
                </span>
              </div>
              {lastValidated && isConnected && (
                <p className="text-xs text-[#5c7d9e] mt-1.5 ml-10">
                  Validated {formatRelative(lastValidated)}
                </p>
              )}
            </div>
          </div>

          {!isConnected ? (
            <div className="rounded-lg border border-[#1585ff]/20 bg-[#1585ff]/5 p-4">
              <p className="text-sm text-[#9ecfff] mb-3">
                Connect your LinkedIn account to start syncing contacts.
              </p>
              <Link
                href="/linkedin-connect"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#1585ff] hover:bg-[#3090ff] text-white text-sm font-medium transition-colors"
              >
                <Terminal className="w-4 h-4" />
                Connect LinkedIn
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#5c7d9e] font-mono uppercase tracking-wide mb-0.5">
                    Last sync
                  </p>
                  {latestSync ? (
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-xs font-mono px-1.5 py-0.5 rounded",
                          latestSync.status === "SUCCEEDED"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : latestSync.status === "RUNNING" || latestSync.status === "QUEUED"
                            ? "bg-[#1585ff]/10 text-[#1585ff]"
                            : "bg-amber-500/10 text-amber-400"
                        )}
                      >
                        {latestSync.status}
                      </span>
                      <span className="text-xs text-[#5c7d9e]">
                        {formatRelative(latestSync.finishedAt ?? latestSync.createdAt)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-[#5c7d9e]">Never synced</p>
                  )}
                </div>
                <button
                  onClick={triggerSync}
                  disabled={syncing}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
                    syncing
                      ? "bg-[#14223a] text-[#5c7d9e] cursor-not-allowed border border-[#25405e]"
                      : "bg-[#1585ff] hover:bg-[#3090ff] text-white"
                  )}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
                  {syncMsg ?? (syncing ? "Starting…" : "Sync Now")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Contacts card */}
        <div className="rounded-xl border border-[#25405e] bg-[#1a2d3f] p-6 flex flex-col">
          <p className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest mb-4">
            Your Contacts
          </p>
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-5xl font-semibold text-[#eaf2fd] font-mono tabular-nums">
              {contactCount.toLocaleString()}
            </p>
            <p className="text-xs text-[#5c7d9e] mt-2">LinkedIn connections synced</p>
          </div>
          <Link
            href="/contacts"
            className="mt-5 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-[#25405e] hover:border-[#1585ff]/40 hover:bg-[#1c3048] text-sm text-[#9ecfff] transition-all group"
          >
            <Users className="w-4 h-4" />
            View Contacts
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-3 rounded-xl border border-[#25405e] bg-[#1a2d3f] p-6">
          <p className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest mb-4">
            Quick Actions
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { href: "/contacts", label: "Browse Contacts", icon: Users },
              { href: "/contacts?seniority=C_LEVEL", label: "C-Level contacts", icon: Users },
              { href: "/templates", label: "Message templates", icon: Terminal },
              { href: "/linkedin-connect", label: isConnected ? "Re-auth LinkedIn" : "Connect LinkedIn", icon: isConnected ? CheckCircle2 : Terminal },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-[#25405e] hover:border-[#1585ff]/30 hover:bg-[#1c3048] text-sm text-[#9ecfff] transition-all group"
              >
                <Icon className="w-4 h-4 shrink-0 text-[#5c7d9e] group-hover:text-[#1585ff] transition-colors" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
