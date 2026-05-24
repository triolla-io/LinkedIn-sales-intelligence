"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Users, FileText, Shield, LogOut, LayoutDashboard, Upload,
  BookMarked, MessageCircle, GitBranch, ChevronLeft, ChevronRight,
} from "lucide-react";
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
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/lists", label: "Lists", icon: BookMarked },
  { href: "/sequences", label: "Sequences", icon: GitBranch },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/import", label: "Import CSV", icon: Upload },
  { href: "/whatsapp-connect", label: "WhatsApp", icon: MessageCircle },
];

const adminItems = [
  { href: "/admin", label: "Team", icon: Shield },
];

export default function Sidebar({ user, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  async function handleSignOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/sign-in";
  }

  return (
    <aside className="flex flex-col h-full bg-white border-r border-[#e5e3df] overflow-hidden">
      {/* Logo */}
      <div className={cn("border-b border-[#e5e3df] shrink-0", collapsed ? "px-3 py-5 flex justify-center" : "px-5 py-5")}>
        <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
          <div className="w-8 h-8 bg-[#1585ff] rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold font-mono">{collapsed ? "S" : "SI"}</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-[#111110] text-sm tracking-tight whitespace-nowrap">LinkedIn SI</span>
          )}
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 px-2.5 py-4 space-y-0.5 overflow-hidden">
        <div className={cn("flex items-center mb-3", collapsed ? "justify-center" : "justify-between px-2.5")}>
          {!collapsed && (
            <p className="text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest">
              Navigation
            </p>
          )}
          <button
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center justify-center w-6 h-6 rounded-md text-[#c8c5c2] hover:text-[#6b6866] hover:bg-[#f3f2ef] transition-colors"
          >
            {collapsed
              ? <ChevronRight className="w-3.5 h-3.5" />
              : <ChevronLeft className="w-3.5 h-3.5" />}
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
                Admin
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
            title="Sign out"
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
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
