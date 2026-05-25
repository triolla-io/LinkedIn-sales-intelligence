"use client";

import Link from "next/link";
import { Users, ArrowRight, Upload, FileText, Terminal } from "lucide-react";
import AutoRefresher from "@/components/auto-refresher";

interface Props {
  user: { name: string; email: string; image?: string | null };
  contactCount: number;
  latestImport: {
    fileName: string;
    added: number;
    updated: number;
    removed: number;
    createdAt: string;
  } | null;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דקות`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שעות`;
  return `לפני ${Math.floor(hrs / 24)} ימים`;
}

export default function DashboardClient({ user, contactCount, latestImport }: Props) {
  return (
    <div className="min-h-full bg-[#f6f5f3] p-8">
      <AutoRefresher />
      <div className="mb-10">
        <p className="text-[#9b9895] text-sm font-mono tracking-widest uppercase mb-1">דשבורד</p>
        <h1 className="text-2xl font-semibold text-[#111110]">
          שלום, {user.name.split(" ")[0]}.
        </h1>
        <p className="text-[#6b6866] text-sm mt-1">{user.email}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Import card */}
        <div className="lg:col-span-2 rounded-xl border border-[#e5e3df] bg-white p-6">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
            ייבוא אחרון
          </p>
          {latestImport ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-[#1585ff]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#111110]">{latestImport.fileName}</p>
                  <p className="text-xs text-[#9b9895]">{formatRelative(latestImport.createdAt)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "נוספו", value: latestImport.added, color: "text-emerald-600" },
                  { label: "עודכנו", value: latestImport.updated, color: "text-[#1585ff]" },
                  { label: "הוסרו", value: latestImport.removed, color: "text-amber-600" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg bg-[#f6f5f3] px-4 py-3">
                    <p className="text-xs text-[#9b9895] font-mono uppercase tracking-wide mb-1">{label}</p>
                    <p className={`text-xl font-semibold font-mono tabular-nums ${color}`}>
                      {value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-700 mb-3">
                אין ייבואים עדיין. העלה קובץ CSV להוספת אנשי קשר.
              </p>
              <Link
                href="/import"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#1585ff] hover:bg-[#0a70e0] text-white text-sm font-medium transition-colors"
              >
                <Upload className="w-4 h-4" />
                ייבוא נתונים
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>

        {/* Contacts card */}
        <div className="rounded-xl border border-[#e5e3df] bg-white p-6 flex flex-col">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
            אנשי הקשר שלך
          </p>
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-5xl font-semibold text-[#111110] font-mono tabular-nums">
              {contactCount.toLocaleString()}
            </p>
            <p className="text-xs text-[#9b9895] mt-2">אנשי קשר שהועלו</p>
          </div>
          <Link
            href="/contacts"
            className="mt-5 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-[#e5e3df] hover:border-blue-200 hover:bg-[#eff5ff] text-sm text-[#6b6866] hover:text-[#1585ff] transition-all group"
          >
            <Users className="w-4 h-4" />
            צפה באנשי קשר
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-3 rounded-xl border border-[#e5e3df] bg-white p-6">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
            פעולות מהירות
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { href: "/contacts", label: "עיון באנשי קשר", icon: Users },
              { href: "/contacts?seniority=C_LEVEL", label: "אנשי קשר בנושאי C-Level", icon: Users },
              { href: "/import", label: "ייבוא נתונים", icon: Upload },
              { href: "/templates", label: "טמפלטים", icon: Terminal },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-[#e5e3df] hover:border-blue-200 hover:bg-[#eff5ff] text-sm text-[#6b6866] hover:text-[#1585ff] transition-all group"
              >
                <Icon className="w-4 h-4 shrink-0 text-[#9b9895] group-hover:text-[#1585ff] transition-colors" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
