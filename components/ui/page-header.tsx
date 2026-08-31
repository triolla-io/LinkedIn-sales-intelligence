import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * כותרת מסך דביקה.
 *
 * שינוי מהגרסה הקודמת: הכותרת עברה לפנים התצוגה (Frank Ruhl Libre) ובגודל
 * שקורא כמו כותרת ולא כמו תווית טופס; אריח האייקון ירד לרמת רמז ולא
 * מתחרה על תשומת הלב עם השם. הרקע נגזר מהטוקן, כך שאותה כותרת עובדת
 * גם בעולם הנייר וגם בחדר המכונות.
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
        "sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--line)]",
        "bg-[var(--background)]/85 px-6 py-3 backdrop-blur-sm",
        className,
      )}
    >
      {Icon && (
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon className="size-3.5" />
        </div>
      )}
      <div className="min-w-0 leading-tight">
        <h1 className="type-h2 truncate text-[var(--foreground)]">{title}</h1>
        {subtitle && (
          <p dir="auto" className="truncate text-xs text-[var(--muted)]">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
