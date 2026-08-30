"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/settings/extension", label: "LinkedIn Extension" },
  { href: "/settings/whatsapp", label: "WhatsApp" },
  // Hidden until the Claude/MCP one-click (OAuth) flow ships — page still exists at /settings/mcp.
  // { href: "/settings/mcp", label: "Claude / MCP" },
  { href: "/settings/signature", label: "חתימת אימייל" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="w-48 shrink-0 border-l border-[var(--line)] bg-[var(--surface-secondary)] py-6 px-3">
        <p className="px-3 mb-3 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">הגדרות</p>
        <nav className="space-y-0.5">
          {NAV.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] font-medium"
                    : "text-[var(--muted)] hover:bg-[var(--separator)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
