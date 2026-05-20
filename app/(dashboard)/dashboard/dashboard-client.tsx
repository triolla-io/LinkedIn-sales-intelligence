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
    color: "text-emerald-600",
    Icon: Wifi,
    ring: "ring-emerald-200 bg-emerald-50",
  },
  EXPIRED: {
    label: "Session expired",
    color: "text-amber-600",
    Icon: AlertCircle,
    ring: "ring-amber-200 bg-amber-50",
  },
  DISCONNECTED: {
    label: "Not connected",
    color: "text-stone-400",
    Icon: WifiOff,
    ring: "ring-stone-200 bg-stone-50",
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
    <div className="min-h-full bg-[#f6f5f3] p-8">
      {/* Header greeting */}
      <div className="mb-10">
        <p className="text-[#9b9895] text-sm font-mono tracking-widest uppercase mb-1">
          Dashboard
        </p>
        <h1 className="text-2xl font-semibold text-[#111110]">
          Good to see you, {user.name.split(" ")[0]}.
        </h1>
        <p className="text-[#6b6866] text-sm mt-1">{user.email}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LinkedIn Status card */}
        <div className="lg:col-span-2 rounded-xl border border-[#e5e3df] bg-white p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-1">
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
                <p className="text-xs text-[#9b9895] mt-1.5 ml-10">
                  Validated {formatRelative(lastValidated)}
                </p>
              )}
            </div>
          </div>

          {!isConnected ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-700 mb-3">
                Connect your LinkedIn account to start syncing contacts.
              </p>
              <Link
                href="/linkedin-connect"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#1585ff] hover:bg-[#0a70e0] text-white text-sm font-medium transition-colors"
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
                  <p className="text-xs text-[#9b9895] font-mono uppercase tracking-wide mb-0.5">
                    Last sync
                  </p>
                  {latestSync ? (
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-xs font-mono px-1.5 py-0.5 rounded",
                          latestSync.status === "SUCCEEDED"
                            ? "bg-emerald-50 text-emerald-600"
                            : latestSync.status === "RUNNING" || latestSync.status === "QUEUED"
                            ? "bg-blue-50 text-blue-600"
                            : "bg-amber-50 text-amber-600"
                        )}
                      >
                        {latestSync.status}
                      </span>
                      <span className="text-xs text-[#6b6866]">
                        {formatRelative(latestSync.finishedAt ?? latestSync.createdAt)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-[#6b6866]">Never synced</p>
                  )}
                </div>
                <button
                  onClick={triggerSync}
                  disabled={syncing}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
                    syncing
                      ? "bg-[#f3f2ef] text-[#9b9895] cursor-not-allowed border border-[#e5e3df]"
                      : "bg-[#1585ff] hover:bg-[#0a70e0] text-white"
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
        <div className="rounded-xl border border-[#e5e3df] bg-white p-6 flex flex-col">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
            Your Contacts
          </p>
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-5xl font-semibold text-[#111110] font-mono tabular-nums">
              {contactCount.toLocaleString()}
            </p>
            <p className="text-xs text-[#9b9895] mt-2">LinkedIn connections synced</p>
          </div>
          <Link
            href="/contacts"
            className="mt-5 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-[#e5e3df] hover:border-blue-200 hover:bg-[#eff5ff] text-sm text-[#6b6866] hover:text-[#1585ff] transition-all group"
          >
            <Users className="w-4 h-4" />
            View Contacts
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-3 rounded-xl border border-[#e5e3df] bg-white p-6">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
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
                className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-[#e5e3df] hover:border-blue-200 hover:bg-[#eff5ff] text-sm text-[#6b6866] hover:text-[#1585ff] transition-all group"
              >
                <Icon className="w-4 h-4 shrink-0 text-[#9b9895] group-hover:text-[#1585ff] transition-colors" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
