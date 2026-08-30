"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import useSWR from "swr";
import { signOut } from "next-auth/react";
import {
  Users, FileText, LogOut, Upload, BookMarked, GitBranch, ChevronLeft, ChevronRight,
  Settings, Search, PartyPopper, Sparkles, Newspaper, Radar, Sun, Send, Wrench, Shield,
  Route as RouteIcon, Contact,
} from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * הניווט — 12 פריטים שטוחים הפכו לחמישה.
 *
 * שתי הבעיות שזה פותר:
 * 1. שלושה פריטים בשם "ראדאר" שאי אפשר להבחין ביניהם, ומסך קונפיגורציה
 *    ("ראדאר טכנולוגי") שישב כאח שווה ליד מסכי שימוש יומיומי.
 * 2. אין סימן לאיזה עולם אתה נכנס.
 *
 * המבנה: חמישה יעדים ראשיים. תת-היעדים של קבוצה נחשפים רק כשנמצאים בתוכה
 * (progressive disclosure) — כך שום דבר לא נעלם, אבל רואים 5–8 פריטים
 * במקום 14. "חדר המכונות" צבוע גרפיט כי המעבר אליו הוא מעבר עולם.
 */

interface SidebarProps {
  user: { name: string; email: string; image?: string | null; role: string };
  collapsed: boolean;
  onToggle: () => void;
}

export type NavChild = { href: string; label: string; icon: typeof Users };
export type NavGroup = {
  key: string;
  href: string;
  label: string;
  icon: typeof Users;
  /** כל תחילית שמסמנת "אנחנו בתוך הקבוצה הזאת" */
  match: string[];
  children?: NavChild[];
  /** קבוצת חדר המכונות — קרקע גרפיט */
  machine?: boolean;
  /** מציג את מונה ההודעות הממתינות */
  badge?: "approvals";
};

export const GROUPS: NavGroup[] = [
  {
    key: "today",
    href: "/dashboard",
    label: "היום",
    icon: Sun,
    match: ["/dashboard"],
    badge: "approvals",
  },
  {
    key: "people",
    href: "/contacts",
    label: "אנשים",
    icon: Users,
    match: ["/contacts", "/lists"],
    children: [
      { href: "/contacts", label: "אנשי קשר", icon: Contact },
      { href: "/lists", label: "רשימות", icon: BookMarked },
      { href: "/routine/radar?tab=people", label: "במעקב ראדאר", icon: Radar },
    ],
  },
  {
    key: "outreach",
    href: "/campaigns",
    label: "הפצה",
    icon: Send,
    match: ["/campaigns", "/templates", "/sequences"],
    children: [
      { href: "/campaigns", label: "קמפיינים", icon: GitBranch },
      { href: "/templates", label: "טמפלטים", icon: FileText },
    ],
  },
  {
    key: "machine",
    href: "/routine/radar?tab=decisions",
    label: "חדר המכונות",
    icon: Wrench,
    machine: true,
    match: ["/routine", "/import"],
    children: [
      { href: "/routine/radar?tab=decisions", label: "מסלול ההחלטות", icon: RouteIcon },
      { href: "/routine/connections", label: "בקשות חברות", icon: Search },
      { href: "/routine/job-changes", label: "עדכוני משתמשים", icon: PartyPopper },
      { href: "/routine/company-signals", label: "חדשות חברות", icon: Sparkles },
      { href: "/routine/fintech-radar", label: "ראדאר פינטק", icon: Newspaper },
      { href: "/routine/tech-radar", label: "ראדאר טכנולוגי", icon: Radar },
      { href: "/import", label: "ייבוא נתונים", icon: Upload },
    ],
  },
  { key: "settings", href: "/settings", label: "הגדרות", icon: Settings, match: ["/settings"] },
];

const fetcher = (u: string) => fetch(u).then((r) => r.json());

async function handleSignOut() {
  await signOut({ callbackUrl: "/sign-in" });
}

/** מפריד href עם query מהמסלול, כדי להשוות לנתיב הנוכחי. */
function pathOf(href: string) {
  return href.split("?")[0];
}
function tabOf(href: string) {
  return new URLSearchParams(href.split("?")[1] ?? "").get("tab");
}

export default function Sidebar({ user, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  // מונה ההודעות הממתינות — הסיבה היחידה שיובל פותח את המערכת בבוקר,
  // ולכן היא נראית מהניווט בלי להיכנס למסך.
  const { data: approvals } = useSWR<{ drafts?: unknown[] }>("/api/radar/approvals", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });
  const pendingCount = approvals?.drafts?.length ?? 0;

  const isChildActive = (href: string) => {
    if (pathOf(href) !== pathname) return false;
    const t = tabOf(href);
    if (!t) return true;
    return (currentTab ?? "approvals") === t;
  };

  const groupActive = (g: NavGroup) => {
    if (g.key === "today") {
      // "היום" תופס גם את הדשבורד הישן וגם את טאב האישורים
      return pathname === "/dashboard" || (pathname === "/routine/radar" && (currentTab ?? "approvals") === "approvals");
    }
    if (g.key === "machine") {
      if (pathname === "/routine/radar") return currentTab === "decisions";
      return g.match.some((m) => pathname.startsWith(m));
    }
    if (g.key === "people" && pathname === "/routine/radar") return currentTab === "people";
    return g.match.some((m) => pathname.startsWith(m));
  };

  return (
    <aside className="flex h-full flex-col overflow-hidden border-s border-[var(--line)] bg-[var(--surface)]">
      {/* ---------- מותג ---------- */}
      <div className={cn("shrink-0 border-b border-[var(--line)]", collapsed ? "flex justify-center px-3 py-4" : "px-4 py-4")}>
        <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
          <span className="relative grid size-7 shrink-0 place-items-center">
            <span className="absolute inset-0 rounded-full bg-[var(--accent-soft)]" />
            <span className="relative size-2.5 rounded-full bg-[var(--accent)]" />
          </span>
          {!collapsed && (
            <span className="font-display whitespace-nowrap text-[17px] font-bold tracking-tight text-[var(--foreground)]">
              LeadFlow
            </span>
          )}
        </div>
      </div>

      {/* ---------- ניווט ---------- */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "justify-end")}>
          <button
            type="button"
            onClick={onToggle}
            title={collapsed ? "הרחב תפריט" : "כווץ תפריט"}
            aria-label={collapsed ? "הרחב תפריט" : "כווץ תפריט"}
            className="fv-ring grid size-6 place-items-center rounded-md text-[var(--faint)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--muted)]"
          >
            {collapsed ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        </div>

        <div className="flex flex-col gap-0.5">
          {GROUPS.map((g) => {
            const active = groupActive(g);
            const Icon = g.icon;
            const showBadge = g.badge === "approvals" && pendingCount > 0;

            return (
              <div key={g.key} className={cn(g.machine && !collapsed && "mt-3 border-t border-[var(--line)] pt-3")}>
                <Link
                  href={g.href}
                  title={collapsed ? g.label : undefined}
                  className={cn(
                    "fv-ring relative flex items-center rounded-lg text-sm font-semibold transition-colors",
                    collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-2",
                    active && "bg-[var(--accent)] text-[var(--accent-foreground)]",
                    !active && "text-[var(--muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && <span className="truncate">{g.label}</span>}
                  {showBadge &&
                    (collapsed ? (
                      // ברייל מכווץ: נקודה בלבד — למספר אין מקום, ולנוכחות יש
                      <span
                        aria-label={`${pendingCount} ממתינות`}
                        className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-[var(--accent)]"
                      />
                    ) : (
                      <span
                        className={cn(
                          "type-num ms-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                          active
                            ? "bg-[var(--accent-foreground)]/25 text-[var(--accent-foreground)]"
                            : "bg-[var(--accent-soft)] text-[var(--accent)]",
                        )}
                      >
                        {pendingCount}
                      </span>
                    ))}
                </Link>

                {/* תת-יעדים — נחשפים רק בתוך הקבוצה הפעילה */}
                {!collapsed && active && g.children && (
                  <div
                    className={cn(
                      "mt-1 flex flex-col gap-0.5 border-s-2 ps-2",
                      "ms-4 border-[var(--line)]",
                    )}
                  >
                    {g.children.map((c) => {
                      const on = isChildActive(c.href);
                      const CIcon = c.icon;
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          className={cn(
                            "fv-ring flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                            on
                              ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                              : "text-[var(--muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]",
                          )}
                        >
                          <CIcon className="size-3.5 shrink-0 opacity-70" />
                          <span className="truncate">{c.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {isAdmin && (
            <Link
              href="/admin"
              title={collapsed ? "ניהול" : undefined}
              className={cn(
                "fv-ring mt-3 flex items-center rounded-lg text-sm font-semibold transition-colors",
                collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-2",
                pathname.startsWith("/admin")
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]",
              )}
            >
              <Shield className="size-4 shrink-0" />
              {!collapsed && "ניהול"}
            </Link>
          )}
        </div>
      </nav>

      {/* ---------- משתמש ---------- */}
      <div className={cn("border-t border-[var(--line)] px-2.5 py-3", collapsed && "flex justify-center")}>
        {collapsed ? (
          <button type="button" onClick={handleSignOut} title="יציאה" aria-label="יציאה" className="fv-ring">
            <Avatar user={user} />
          </button>
        ) : (
          <div className="flex items-center gap-2.5 px-1.5 py-1">
            <Avatar user={user} />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-xs font-semibold text-[var(--foreground)]">{user.name}</p>
              <p dir="ltr" className="truncate text-start text-[10px] text-[var(--faint)]">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="fv-ring rounded-md p-1 text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
              title="יציאה"
              aria-label="יציאה"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function Avatar({ user }: { user: { name: string; image?: string | null } }) {
  if (user.image) {
    return (
      <Image
        src={user.image}
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
      />
    );
  }
  return (
    <div className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)]">
      <span className="text-xs font-semibold text-[var(--accent)]">{user.name.charAt(0).toUpperCase()}</span>
    </div>
  );
}
