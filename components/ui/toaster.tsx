"use client";

import { useEffect, useState } from "react";
import { toast as toastStore, ToastEntry } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";

const VARIANT_STYLES: Record<ToastEntry["variant"], string> = {
  success: "bg-white border-emerald-200 text-emerald-700",
  error: "bg-white border-red-200 text-red-600",
  info: "bg-white border-[#1585ff]/20 text-[#1585ff]",
};

const ICON: Record<ToastEntry["variant"], React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 shrink-0" />,
  error: <AlertCircle className="w-4 h-4 shrink-0" />,
  info: <Info className="w-4 h-4 shrink-0" />,
};

function ToastItem({ toast }: { toast: ToastEntry }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // trigger enter animation on mount
    const show = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => {
      setVisible(false);
      setTimeout(() => toastStore.dismiss(toast.id), 300);
    }, toast.durationMs);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(hide);
    };
  }, [toast.id, toast.durationMs]);

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-lg border shadow-md max-w-sm w-full",
        "transition-all duration-300",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        VARIANT_STYLES[toast.variant]
      )}
    >
      {ICON[toast.variant]}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{toast.title}</p>
        {toast.body && (
          <p className="text-xs mt-0.5 opacity-80 leading-snug">{toast.body}</p>
        )}
      </div>
      <button
        onClick={() => toastStore.dismiss(toast.id)}
        className="shrink-0 opacity-50 hover:opacity-80 transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    return toastStore.subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
