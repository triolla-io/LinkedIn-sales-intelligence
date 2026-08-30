import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * חדר המכונות — העולם של אריאל.
 *
 * `data-theme="dark"` מחליף את כל טוקני הצבע לגרפיט, וכל קומפוננטת HeroUI
 * בתוך התת-עץ מתהפכת איתם. אותן קומפוננטות, אותו ריווח, קרקע אחרת:
 * מי שנכנס יודע תוך שנייה שהוא עבר מהסלון למטבח.
 */
export function MachineRoom({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-theme="dark"
      className={cn("bg-[var(--background)] text-[var(--foreground)]", className)}
    >
      {children}
    </div>
  );
}
