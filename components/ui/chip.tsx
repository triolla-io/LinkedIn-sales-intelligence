import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * משפחת הצ'יפים היחידה במערכת.
 *
 * כלל מהבריף: צ'יפ לא מעמיד פנים שהוא יודע יותר מהדאטה.
 * `verified` מוצג רק כשבאמת קיים מקור מאומת — אחרת משתמשים ב-tone="neutral".
 */
export type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-[var(--neutral-soft)] text-[var(--muted)] border-[var(--line)]",
  accent: "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/25",
  success: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/25",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/25",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/25",
};

export function Chip({
  tone = "neutral",
  icon: Icon,
  children,
  className,
  title,
}: {
  tone?: ChipTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" />}
      {children}
    </span>
  );
}

/**
 * צ'יפ סטטוס לרשומות שרצות (קמפיין, ריצה, מודול).
 * אדום שמור לכישלון בלבד — "מושהה" הוא מצב ניטרלי, לא שגיאה.
 */
const STATUS_TONE: Record<string, ChipTone> = {
  active: "success",
  running: "success",
  done: "accent",
  completed: "accent",
  paused: "neutral",
  draft: "neutral",
  idle: "neutral",
  pending: "warning",
  waiting: "warning",
  failed: "danger",
  error: "danger",
};

export function StatusChip({
  status,
  label,
  className,
}: {
  status: keyof typeof STATUS_TONE | string;
  label: string;
  className?: string;
}) {
  return (
    <Chip tone={STATUS_TONE[status] ?? "neutral"} className={className}>
      {label}
    </Chip>
  );
}
