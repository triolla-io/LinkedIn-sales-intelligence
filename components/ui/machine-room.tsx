import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * חדר המכונות — העולם של אריאל (כיול, משפך, מסלול החלטות).
 *
 * הוא מובחן מהעולם של יובל, אבל בתוך אותו עולם בהיר: נייר עמוק יותר
 * במקצת וקו מפריד, במקום קרקע כהה. אותן קומפוננטות, אותו ריווח —
 * רק העומק של הקרקע משתנה.
 */
export function MachineRoom({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-[var(--surface-secondary)] text-[var(--foreground)]", className)}>
      {children}
    </div>
  );
}
