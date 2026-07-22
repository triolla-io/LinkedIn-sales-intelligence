import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Sticky dashboard page header: a brand-tinted icon tile, a title with an
 * optional one-line subtitle, and optional trailing actions. RTL by default.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      dir="rtl"
      className={cn(
        "flex items-center gap-3 px-6 py-3.5 border-b border-[#e7e4dd] bg-white/90 backdrop-blur-sm sticky top-0 z-10",
        className,
      )}
    >
      {Icon && (
        <div className="grid place-items-center size-8 rounded-lg bg-[#1585ff]/10 text-[#1585ff] shrink-0">
          <Icon className="size-4" />
        </div>
      )}
      <div className="leading-tight min-w-0">
        <h1 className="text-[15px] font-semibold text-[#1a1917] truncate">{title}</h1>
        {subtitle && <p className="text-xs text-[#9b9895] truncate">{subtitle}</p>}
      </div>
      {actions && <div className="mr-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
