/**
 * הלוגו של Linked — "הטבעות": שתי טבעות שזורות, הימנית באקסנט.
 * ראו claude/linked-logo.md בפרויקט. הצבעים נמשכים מהטוקנים:
 * הטבעת הראשית מ-currentColor (צבע הטקסט של ההורה), הירוקה מ---accent.
 */
import { cn } from "@/lib/cn";

export function LinkedMark({
  className,
  accent = "var(--accent)",
}: {
  className?: string;
  accent?: string;
}) {
  return (
    <svg
      viewBox="3 21.5 114 77"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeWidth={13.5}>
        <circle cx="42" cy="60" r="30" stroke="currentColor" />
        <circle cx="78" cy="60" r="30" stroke={accent} />
        {/* השזירה: הטבעת השמאלית חוזרת מעל בהצטלבות העליונה */}
        <path d="M 44.6 30.2 A 30 30 0 0 1 70.2 49.8" stroke="currentColor" />
      </g>
    </svg>
  );
}

export function LinkedLogo({
  className,
  markClassName = "h-6 w-auto",
  textClassName = "text-[17px]",
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-2.5 text-[var(--foreground)]",
        className,
      )}
      dir="ltr"
    >
      <LinkedMark className={markClassName} />
      <span
        className={cn(
          "font-display whitespace-nowrap font-extrabold tracking-tight",
          textClassName,
        )}
      >
        Linked
      </span>
    </span>
  );
}
