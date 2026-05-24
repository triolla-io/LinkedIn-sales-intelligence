"use client";

import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";

export default function AutoRefresher({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useAutoRefresh(() => { router.refresh(); }, intervalMs);
  return null;
}
