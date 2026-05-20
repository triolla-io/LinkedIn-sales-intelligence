"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Users, FileText, Shield, LogOut, LayoutDashboard, Upload, BookMarked } from "lucide-react";
import { cn } from "@/lib/cn";

interface SidebarProps {
  user: {
    name: string;
    email: string;
    image?: string | null;
    role: string;
  };
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/lists", label: "Lists", icon: BookMarked },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/import", label: "Import CSV", icon: Upload },
  { href: "/linkedin-connect", label: "LinkedIn", icon: Wifi },
];

const adminItems = [
  { href: "/admin", label: "Team", icon: Shield },
];

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  async function handleSignOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/sign-in";
  }

  return (
    <aside className="flex flex-col h-full bg-white border-r border-[#e5e3df]">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#e5e3df]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-[#1585ff] rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold font-mono">SI</span>
          </div>
          <span className="font-semibold text-[#111110] text-sm tracking-tight">LinkedIn SI</span>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 px-2.5 py-4 space-y-0.5">
        <p className="px-2.5 mb-3 text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest">
          Navigation
        </p>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-[#eff5ff] text-[#1585ff] font-medium"
                  : "text-[#6b6866] hover:bg-[#f3f2ef] hover:text-[#111110]"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <p className="px-2.5 mt-5 mb-2 text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest">
              Admin
            </p>
            {adminItems.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                    active
                      ? "bg-[#eff5ff] text-[#1585ff] font-medium"
                      : "text-[#6b6866] hover:bg-[#f3f2ef] hover:text-[#111110]"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User Footer */}
      <div className="px-2.5 py-4 border-t border-[#e5e3df]">
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
      </div>
    </aside>
  );
}
