"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";

interface ImpersonationBannerProps {
  name: string;
}

export default function ImpersonationBanner({ name }: ImpersonationBannerProps) {
  const router = useRouter();

  async function handleExit() {
    await fetch("/api/admin/impersonate", { method: "DELETE" });
    router.push("/contacts");
    router.refresh();
  }

  return (
    <div className="bg-[var(--warning-soft)] border-b border-[var(--warning)]/30 px-4 py-2 flex items-center justify-between">
      <p className="text-sm text-[var(--warning)] font-medium">
        Viewing as <span className="font-bold">{name}</span>
      </p>
      <button
        type="button"
        onClick={handleExit}
        className="flex items-center gap-1 text-sm text-[var(--warning)] hover:text-[var(--warning)] font-medium transition-colors"
      >
        <X className="size-3" />
        Exit
      </button>
    </div>
  );
}
