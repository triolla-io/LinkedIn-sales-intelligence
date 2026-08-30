import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** כרטיס נייר — רדיוס אחד, ריווח אחד, צל אחד לכל המערכת. */
export function Card({
  children,
  className,
  interactive = false,
  tone,
}: {
  children: ReactNode;
  className?: string;
  /** מוסיף מצב hover — רק לכרטיס שבאמת נלחץ */
  interactive?: boolean;
  /** פס צד סמנטי — רק כשהמצב באמת חריג */
  tone?: "accent" | "warning" | "danger" | "success";
}) {
  const rail =
    tone &&
    {
      accent: "border-s-[3px] border-s-[var(--accent)]",
      warning: "border-s-[3px] border-s-[var(--warning)]",
      danger: "border-s-[3px] border-s-[var(--danger)]",
      success: "border-s-[3px] border-s-[var(--success)]",
    }[tone];

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-paper)]",
        interactive &&
          "transition-colors hover:border-[var(--accent)]/40 hover:shadow-[var(--shadow-lift)]",
        rail,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** גוף כרטיס עם הריווח הסטנדרטי. */
export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}
