"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ExternalLink, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { PageHeader } from "@/components/ui/page-header";
import useSWR from "swr";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  contactCount: number;
  lastSyncedAt: string | null;
  creditsConsumed: number;
  creditsLimit: number;
}

interface AdminUsersResponse {
  org: { creditsUsed: number; creditsLimit: number; perUserLimit: number; month: string };
  users: AdminUser[];
}

const ROLE_STYLES: Record<string, string> = {
  SUPER_ADMIN: "bg-[#f3e8ff] text-[#7c3aed]",
  ADMIN: "bg-[#e6f4ff] text-[#1585ff]",
  SALESPERSON: "bg-[#f3f2ef] text-[#6b6866]",
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status === 403) {
    const err = new Error("You don't have permission to view this page") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
};

const TH = "text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider";

/** Shared monthly Apollo pool for the whole org — the outer ceiling every
 *  per-user quota sits inside. */
function OrgPoolBar({
  org,
}: {
  org: { creditsUsed: number; creditsLimit: number; perUserLimit: number; month: string };
}) {
  const pct = org.creditsLimit > 0 ? Math.min(100, (org.creditsUsed / org.creditsLimit) * 100) : 100;
  const spent = org.creditsUsed >= org.creditsLimit;
  return (
    <div className={cn(ui.card, "p-4 mb-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-[#1a1917]">
          בריכת הקרדיטים החודשית של הארגון
        </p>
        <p className="text-sm tabular-nums">
          <span className={spent ? "text-[#c2410c] font-medium" : "text-[#1a1917]"}>
            {org.creditsUsed.toLocaleString()}
          </span>
          <span className="text-[#9b9895]"> / {org.creditsLimit.toLocaleString()}</span>
        </p>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-[#ece9e3] overflow-hidden">
        <div
          className={cn("h-full rounded-full", spent ? "bg-[#c2410c]" : "bg-[#1585ff]")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-[#9b9895]">
        מכסה אישית לכל משתמש: {org.perUserLimit.toLocaleString()} קרדיטים · אימייל = 1, טלפון = 8
      </p>
    </div>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { data, error: swrError, mutate, isValidating } = useSWR<AdminUsersResponse>(
    "/api/admin/users",
    fetcher,
  );
  const users = data?.users;
  const org = data?.org;
  const [impersonating, setImpersonating] = useState<string | null>(null);

  const error = swrError?.message || null;
  const refreshing = isValidating;

  async function refreshUsers() {
    await mutate();
  }

  async function handleImpersonate(userId: string) {
    setImpersonating(userId);
    try {
      const res = await fetch(`/api/admin/impersonate/${userId}`, { method: "POST" });
      if (!res.ok) {
        console.error("Impersonation failed");
        return;
      }
      router.push("/contacts");
      router.refresh();
    } catch {
      console.error("Impersonation error");
    } finally {
      setImpersonating(null);
    }
  }

  const isLoading = !users && !error;

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <PageHeader
        icon={Users}
        title="משתמשים"
        subtitle="נהל משתמשים בארגון שלך"
        actions={
          <button
            type="button"
            onClick={refreshUsers}
            disabled={refreshing}
            aria-label="רענן רשימת משתמשים"
            className={ui.btnSecondary}
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            רענן
          </button>
        }
      />

      <div className="w-full max-w-5xl mx-auto px-6 pt-6 pb-10">
        {error ? (
          <div className="bg-[#fff3f3] border border-[#fde2e2] rounded-xl p-4 text-[#dc2626] text-sm">
            {error === "You don't have permission to view this page" ? "אין לך הרשאה לצפות בדף זה" : error}
          </div>
        ) : isLoading ? (
          <div className={cn(ui.card, "overflow-hidden")}>
            <div className="animate-pulse divide-y divide-[#e7e4dd]">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4">
                  <div className="h-4 bg-[#ece9e3] rounded w-32" />
                  <div className="h-4 bg-[#ece9e3] rounded w-48" />
                  <div className="h-5 bg-[#ece9e3] rounded-full w-20" />
                  <div className="h-4 bg-[#ece9e3] rounded w-12" />
                  <div className="h-4 bg-[#ece9e3] rounded w-24" />
                  <div className="h-4 bg-[#ece9e3] rounded w-16" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {org ? <OrgPoolBar org={org} /> : null}
          <div className={cn(ui.card, "overflow-hidden")}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e7e4dd] bg-[#fafaf9]">
                  <th className={TH}>שם</th>
                  <th className={TH}>אימייל</th>
                  <th className={TH}>תפקיד</th>
                  <th className={TH}>אנשי קשר</th>
                  <th className={TH}>סנכרן אחרון</th>
                  <th className={TH}>קרדיטים</th>
                  <th className="px-4 py-2.5" aria-label="פעולות" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e4dd]">
                {(users ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-[#9b9895] text-sm">
                      לא נמצאו משתמשים
                    </td>
                  </tr>
                ) : (
                  (users ?? []).map((user) => (
                    <tr key={user.id} className="hover:bg-[#fafaf9] transition-colors">
                      <td className="px-4 py-3 font-medium text-[#1a1917]">{user.name}</td>
                      <td className="px-4 py-3 text-[#6b6866]">{user.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                            ROLE_STYLES[user.role] ?? "bg-[#f3f2ef] text-[#6b6866]",
                          )}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[#6b6866]">
                        {user.contactCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-[#9b9895]">
                        {user.lastSyncedAt
                          ? new Date(user.lastSyncedAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })
                          : "לעולם לא"}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        <span
                          className={cn(
                            user.creditsConsumed >= user.creditsLimit
                              ? "text-[#c2410c] font-medium"
                              : user.creditsConsumed >= user.creditsLimit * 0.8
                                ? "text-[#a16207]"
                                : "text-[#6b6866]",
                          )}
                        >
                          {user.creditsConsumed.toLocaleString()}
                        </span>
                        <span className="text-[#9b9895]"> / {user.creditsLimit.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3 text-left">
                        <button
                          type="button"
                          onClick={() => handleImpersonate(user.id)}
                          disabled={impersonating === user.id}
                          aria-label={`צפה בחשבון של ${user.name}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1585ff] hover:text-[#0a70e0] transition-colors disabled:opacity-50"
                        >
                          {impersonating === user.id ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            <ExternalLink className="size-3" />
                          )}
                          צפה כ
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
