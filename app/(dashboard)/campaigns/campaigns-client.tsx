"use client";
import Link from "next/link";
import AutoRefresher from "@/components/auto-refresher";

type Row = {
  id: string;
  name: string;
  status: string;
  createdAt: Date | string;
  template: { name: string };
  _count: { recipients: number };
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "text-stone-500 bg-stone-100",
  QUEUED: "text-blue-600 bg-blue-50",
  RUNNING: "text-emerald-600 bg-emerald-50",
  PAUSED: "text-amber-600 bg-amber-50",
  COMPLETED: "text-emerald-700 bg-emerald-50",
  CANCELLED: "text-red-500 bg-red-50",
};

export function CampaignsClient({ campaigns }: { campaigns: Row[] }) {
  return (
    <div className="p-8 bg-[#f6f5f3] min-h-full">
      <AutoRefresher />
      <h1 className="text-2xl font-semibold text-[#111110]">Campaigns</h1>
      <div className="mt-6 bg-white border border-[#e5e3df] rounded-xl overflow-hidden">
        <table className="w-full text-sm text-[#6b6866]">
          <thead className="text-left text-[#9b9895] bg-[#f8f7f5]">
            <tr>
              <th className="py-3 px-5 pr-4 font-mono text-[10px] uppercase tracking-widest">Name</th>
              <th className="pr-4 font-mono text-[10px] uppercase tracking-widest">Template</th>
              <th className="pr-4 font-mono text-[10px] uppercase tracking-widest">Recipients</th>
              <th className="pr-4 font-mono text-[10px] uppercase tracking-widest">Status</th>
              <th className="font-mono text-[10px] uppercase tracking-widest">Created</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t border-[#e5e3df] hover:bg-[#f8f7f5] transition-colors">
                <td className="py-3 px-5 pr-4">
                  <Link href={`/campaigns/${c.id}`} className="text-[#1585ff] hover:text-[#0a70e0] transition-colors">
                    {c.name}
                  </Link>
                </td>
                <td className="pr-4">{c.template.name}</td>
                <td className="pr-4 font-mono tabular-nums">{c._count.recipients}</td>
                <td className="pr-4">
                  <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_COLORS[c.status] ?? "text-stone-500 bg-stone-100"}`}>
                    {c.status}
                  </span>
                </td>
                <td>{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-[#9b9895]">
                  No campaigns yet. Select contacts and click &quot;Send Campaign&quot; to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
