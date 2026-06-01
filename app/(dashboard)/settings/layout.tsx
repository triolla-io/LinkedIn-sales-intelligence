import Link from "next/link";

const NAV = [
  { href: "/settings/extension", label: "LinkedIn Extension" },
  { href: "/settings/whatsapp", label: "WhatsApp" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-48 shrink-0 border-l border-[#e5e3df] bg-[#fafaf9] py-6 px-3">
        <p className="px-3 mb-3 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">הגדרות</p>
        <nav className="space-y-0.5">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="block px-3 py-2 rounded-lg text-sm text-[#6b6866] hover:bg-[#f0efed] hover:text-[#111110] transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
