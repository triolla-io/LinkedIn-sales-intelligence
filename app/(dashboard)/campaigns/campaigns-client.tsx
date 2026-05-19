"use client";
import Link from "next/link";

type Row = {
  id: string;
  name: string;
  status: string;
  createdAt: Date | string;
  template: { name: string };
  _count: { recipients: number };
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "text-slate-400 bg-slate-800",
  QUEUED: "text-blue-300 bg-blue-900/40",
  RUNNING: "text-green-300 bg-green-900/40",
  PAUSED: "text-amber-300 bg-amber-900/40",
  COMPLETED: "text-emerald-300 bg-emerald-900/40",
  CANCELLED: "text-red-300 bg-red-900/40",
};

export function CampaignsClient({ campaigns }: { campaigns: Row[] }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Campaigns</h1>
      <table className="mt-6 w-full text-sm text-slate-300">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-2 pr-4">Name</th>
            <th className="pr-4">Template</th>
            <th className="pr-4">Recipients</th>
            <th className="pr-4">Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t border-[#152030]">
              <td className="py-3 pr-4">
                <Link href={`/campaigns/${c.id}`} className="text-[#1585ff] hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="pr-4">{c.template.name}</td>
              <td className="pr-4">{c._count.recipients}</td>
              <td className="pr-4">
                <span className={`rounded px-2 py-1 text-xs ${STATUS_COLORS[c.status] ?? "bg-[#152030]"}`}>
                  {c.status}
                </span>
              </td>
              <td>{new Date(c.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={5} className="py-12 text-center text-slate-500">
                No campaigns yet. Select contacts and click &quot;Send Campaign&quot; to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
