"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { cn } from "@/lib/cn";
import { GROUPS } from "./sidebar";

/**
 * ניווט מובייל — פס תחתון.
 *
 * למה לא הרייל הצדדי: על מסך 390px רייל של 56px גוזל 14% מהרוחב לכל אורך
 * הגלילה, ובעברית הוא גם חוסם את הצד שאליו העין חוזרת. פס תחתון הוא
 * הדפוס הטבעי בטלפון — האגודל מגיע אליו, והתוכן מקבל את כל הרוחב.
 *
 * חמשת אותם יעדים של הדסקטופ, מאותו מודל — בלי עותק שני שיתפצל עם הזמן.
 */

const fetcher = (u: string) => fetch(u).then((r) => r.json());

export function MobileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  const { data } = useSWR<{ drafts?: unknown[] }>("/api/radar/approvals", fetcher, {
    refreshInterval: 60_000,
  });
  const pending = data?.drafts?.length ?? 0;

  const isActive = (key: string, match: string[]) => {
    if (key === "today") {
      return (
        pathname === "/dashboard" ||
        (pathname === "/routine/radar" && (currentTab ?? "approvals") === "approvals")
      );
    }
    if (key === "machine") {
      if (pathname === "/routine/radar") return currentTab === "decisions";
      return match.some((m) => pathname.startsWith(m));
    }
    if (key === "people" && pathname === "/routine/radar") return currentTab === "people";
    return match.some((m) => pathname.startsWith(m));
  };

  return (
    <nav
      dir="rtl"
      aria-label="ניווט ראשי"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex md:hidden",
        "border-t border-[var(--line)] bg-[var(--surface)]",
        // מרווח למחוות הבית של iOS
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {GROUPS.map((g) => {
        const active = isActive(g.key, g.match);
        const Icon = g.icon;
        const showBadge = g.badge === "approvals" && pending > 0;
        return (
          <Link
            key={g.key}
            href={g.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "fv-ring relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors",
              active ? "text-[var(--accent)]" : "text-[var(--muted)]",
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              {showBadge && (
                <span className="type-num absolute -end-2 -top-1.5 min-w-4 rounded-full bg-[var(--accent)] px-1 text-[10px] leading-4 text-[var(--accent-foreground)]">
                  {pending}
                </span>
              )}
            </span>
            {g.label}
          </Link>
        );
      })}
    </nav>
  );
}
