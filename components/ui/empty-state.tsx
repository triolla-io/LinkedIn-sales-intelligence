import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * מצב ריק — לעולם לא "0 נמצאו".
 *
 * כלל מהבריף: יום ריק חייב להיראות כמו החלטה, לא כמו תקלה.
 * לכן כל מצב ריק אומר *למה* הוא ריק ו*מה יקרה הלאה*.
 *
 * `reason`  — למה אין כאן כלום (עובדה, לא התנצלות)
 * `next`    — מה יקרה מעצמו, או מה אפשר לעשות
 * `variant` — "first" (עוד לא התחלנו) מול "filtered" (יש דאטה, הסינון הסתיר)
 */
export function EmptyState({
  icon: Icon,
  title,
  reason,
  next,
  action,
  variant = "first",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  reason?: string;
  next?: string;
  action?: ReactNode;
  variant?: "first" | "filtered";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 rounded-[var(--radius-card)] px-6 py-14",
        variant === "filtered"
          ? "border border-dashed border-[var(--line)]"
          : "border border-[var(--line)] bg-[var(--surface)]",
        className,
      )}
    >
      {Icon && (
        <div className="grid place-items-center size-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon className="size-5" />
        </div>
      )}
      <p className="type-h2 text-[var(--foreground)]">{title}</p>
      {reason && <p className="max-w-[42ch] text-sm text-[var(--muted)]">{reason}</p>}
      {next && <p className="max-w-[42ch] text-sm text-[var(--faint)]">{next}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
