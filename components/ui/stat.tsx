import { cn } from "@/lib/cn";

/** מספר יחיד עם תווית. מונוספייס רק על הספרה — התווית נשארת עברית רגילה. */
export function Stat({
  value,
  label,
  tone = "default",
  className,
}: {
  value: string | number;
  label: string;
  tone?: "default" | "accent" | "muted";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span
        className={cn(
          "type-num text-2xl font-semibold leading-none",
          tone === "accent" && "text-[var(--accent)]",
          tone === "muted" && "text-[var(--faint)]",
          tone === "default" && "text-[var(--foreground)]",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-[var(--muted)]">{label}</span>
    </div>
  );
}

/**
 * משפך — רצף שלבים שבו כל שלב מצומצם מקודמו.
 * המספור כאן אמיתי: זה תהליך, לא קישוט.
 */
export function Funnel({
  steps,
  className,
}: {
  steps: { value: number | string; label: string }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--line)]",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => (
        <div key={s.label} className="bg-[var(--surface)] px-3 py-3.5 text-center">
          <div
            className={cn(
              "type-num text-2xl font-semibold leading-none",
              i === steps.length - 1 ? "text-[var(--accent)]" : "text-[var(--foreground)]",
            )}
          >
            {s.value}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
