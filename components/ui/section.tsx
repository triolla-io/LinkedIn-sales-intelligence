import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** מדור בתוך מסך — כותרת בפנים התצוגה, ואז התוכן. */
export function Section({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline gap-3">
        <h2 className="type-h2 text-[var(--foreground)]">{title}</h2>
        {hint && <p className="text-sm text-[var(--faint)]">{hint}</p>}
        {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
