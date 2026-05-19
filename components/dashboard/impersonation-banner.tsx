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
    <div className="bg-yellow-100 border-b border-yellow-300 px-4 py-2 flex items-center justify-between">
      <p className="text-sm text-yellow-800 font-medium">
        Viewing as <span className="font-bold">{name}</span>
      </p>
      <button
        onClick={handleExit}
        className="flex items-center gap-1 text-sm text-yellow-700 hover:text-yellow-900 font-medium transition-colors"
      >
        <X className="w-3 h-3" />
        Exit
      </button>
    </div>
  );
}
