"use client";

import { Suspense, useEffect, useState } from "react";
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
  // On a phone the expanded sidebar leaves ~150px for content. Below md the stored
  // preference is ignored and the rail stays collapsed — same post-hydration state
  // pattern as useCollapsed itself, so SSR markup never mismatches.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const effective = narrow || collapsed;

  return (
    <div
      className="shrink-0 transition-[width] duration-200 ease-in-out"
      style={{ width: effective ? 56 : 240 }}
    >
      {/* useSearchParams (הניווט קורא ?tab=) מחייב גבול Suspense */}
      <Suspense fallback={<div className="h-full border-s border-[var(--line)] bg-[var(--surface)]" />}>
        <Sidebar user={user} collapsed={effective} onToggle={toggle} />
      </Suspense>
    </div>
  );
}
