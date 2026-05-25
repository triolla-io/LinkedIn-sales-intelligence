"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Users, FileText, Shield, LogOut, LayoutDashboard, Upload,
  BookMarked, GitBranch, ChevronLeft, ChevronRight,
} from "lucide-react";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 448 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/>
    </svg>
  );
}
import { cn } from "@/lib/cn";

interface SidebarProps {
  user: {
    name: string;
    email: string;
    image?: string | null;
    role: string;
  };
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { href: "/dashboard", label: "דשבורד", icon: LayoutDashboard },
  { href: "/contacts", label: "אנשי קשר", icon: Users },
  { href: "/lists", label: "רשימות תפוצה", icon: BookMarked },
  { href: "/campaigns", label: "קמפיינים", icon: GitBranch },
  { href: "/templates", label: "טמפלטים", icon: FileText },
  { href: "/import", label: "ייבוא נתונים", icon: Upload },
  { href: "/whatsapp-connect", label: "WhatsApp", icon: WhatsAppIcon },
];

const adminItems = [
  { href: "/admin", label: "ניהול", icon: Shield },
];

export default function Sidebar({ user, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  async function handleSignOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/sign-in";
  }

  return (
    <aside className="flex flex-col h-full bg-white border-l border-[#e5e3df] overflow-hidden">
      {/* Logo */}
      <div className={cn("border-b border-[#e5e3df] shrink-0", collapsed ? "px-3 py-5 flex justify-center" : "px-5 py-5")}>
        <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
          <div className="w-8 h-8 bg-[#1585ff] rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold font-mono">{collapsed ? "L" : "LF"}</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-[#111110] text-sm tracking-tight whitespace-nowrap">LeadFlow</span>
          )}
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 px-2.5 py-4 space-y-0.5 overflow-hidden">
        <div className={cn("flex items-center mb-3", collapsed ? "justify-center" : "justify-between px-2.5")}>
          {!collapsed && (
            <p className="text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest">
              ניווט
            </p>
          )}
          <button
            onClick={onToggle}
            title={collapsed ? "הרחב תפריט" : "כווץ תפריט"}
            className="flex items-center justify-center w-6 h-6 rounded-md text-[#c8c5c2] hover:text-[#6b6866] hover:bg-[#f3f2ef] transition-colors"
          >
            {collapsed
              ? <ChevronLeft className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-2.5 py-2",
                active
                  ? "bg-[#eff5ff] text-[#1585ff] font-medium"
                  : "text-[#6b6866] hover:bg-[#f3f2ef] hover:text-[#111110]"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            {!collapsed && (
              <p className="px-2.5 mt-5 mb-2 text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest">
                ניהול
              </p>
            )}
            {collapsed && <div className="my-2 border-t border-[#e5e3df]" />}
            {adminItems.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center rounded-md text-sm transition-colors",
                    collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-2.5 py-2",
                    active
                      ? "bg-[#eff5ff] text-[#1585ff] font-medium"
                      : "text-[#6b6866] hover:bg-[#f3f2ef] hover:text-[#111110]"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!collapsed && label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User Footer */}
      <div className={cn("px-2.5 py-4 border-t border-[#e5e3df]", collapsed && "flex justify-center")}>
        {collapsed ? (
          <button
            onClick={handleSignOut}
            title="יציאה"
            className="flex items-center justify-center"
          >
            {user.image ? (
              <img
                src={user.image}
                alt={user.name}
                className="w-7 h-7 rounded-full object-cover ring-1 ring-[#e5e3df]"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#e5e3df] flex items-center justify-center">
                <span className="text-[#6b6866] text-xs font-mono font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md">
            {user.image ? (
              <img
                src={user.image}
                alt={user.name}
                className="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-[#e5e3df]"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#e5e3df] flex items-center justify-center shrink-0">
                <span className="text-[#6b6866] text-xs font-mono font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#111110] truncate">{user.name}</p>
              <p className="text-[10px] text-[#9b9895] truncate">{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="text-[#c8c5c2] hover:text-[#9b9895] transition-colors"
              title="יציאה"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
