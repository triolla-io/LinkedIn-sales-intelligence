import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * פרימיטיבים של טקסט דו-כיווני.
 *
 * הבעיה שהם פותרים: המערכת מציגה עברית ואנגלית באותה שורה —
 * שם לועזי, תפקיד, שם חברה, URL, תאריך. בלי בידוד, הפיסוק קופץ
 * לצד הלא נכון ומשפט נשבר. כל תוכן מעורב עובר דרך כאן.
 */

/** מחרוזת לטינית בתוך משפט עברי (שם, חברה, תפקיד). */
export function Bidi({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("bidi-isolate", className)}>{children}</span>;
}

/** בלוק אנגלי מלא — תקציר כתבה לועזי. יישור לשמאל, לא RTL שבור. */
export function LtrBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p dir="ltr" className={cn("ltr-block", className)}>
      {children}
    </p>
  );
}

/** מספר בתוך טקסט עברי — ספרות מיושרות, בלי היפוך. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("num-inline type-num", className)}>{children}</span>;
}

/**
 * טקסט שמקורו במשתמש/בדאטה ועשוי להיות בכל שפה.
 * dir="auto" נותן לדפדפן להחליט לפי התו החזק הראשון.
 */
export function AutoDir({
  children,
  as: As = "span",
  className,
}: {
  children: ReactNode;
  as?: "span" | "p" | "div" | "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <As dir="auto" className={cn("bidi-isolate", className)}>
      {children}
    </As>
  );
}
