"use client";

import { useCollapsed } from "@/lib/hooks/use-collapsed";
import Sidebar from "@/components/dashboard/sidebar";

interface SidebarShellProps {
  user: {
    name: string;
    email: string;
    image?: string | null;
    role: string;
  };
}

export default function SidebarShell({ user }: SidebarShellProps) {
  const [collapsed, toggle] = useCollapsed("nav-sidebar-collapsed");

  return (
    <div
      className="shrink-0 transition-[width] duration-200 ease-in-out"
      style={{ width: collapsed ? 56 : 240 }}
    >
      <Sidebar user={user} collapsed={collapsed} onToggle={toggle} />
    </div>
  );
}
