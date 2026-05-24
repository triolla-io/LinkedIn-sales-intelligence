"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AutoRefresher from "@/components/auto-refresher";

type Recipient = {
  id: string;
  status: string;
  sentAt: string | null;
  renderedBody: string | null;
  errorMessage: string | null;
  contact: { fullName: string; currentTitle: string | null; currentCompany: string | null };
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  channel: string;
  template: { name: string };
  recipients: Recipient[];
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-stone-400",
  SENDING: "text-blue-600",
  SENT: "text-emerald-600",
  FAILED: "text-red-500",
  SKIPPED: "text-amber-600",
};

export function CampaignDetailClient({ initial }: { initial: Campaign }) {
  const [campaign, setCampaign] = useState<Campaign>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/linkedin/events");
    es.addEventListener("message", async (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data as string);
        if ((payload.type === "campaign:sent" || payload.type === "campaign:update") && payload.data.campaignId === campaign.id) {
          const res = await fetch(`/api/campaigns/${campaign.id}`);
          const json = await res.json();
          setCampaign(json.campaign);
        }
      } catch { /* ignore malformed events */ }
    });
    return () => es.close();
  }, [campaign.id]);

  useEffect(() => {
    const active = ["QUEUED", "RUNNING"].includes(campaign.status);
    if (!active) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/campaigns/${campaign.id}`);
      if (res.ok) {
        const json = await res.json();
        setCampaign(json.campaign);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [campaign.id, campaign.status]);

  const counts = campaign.recipients.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  async function action(verb: "pause" | "resume" | "cancel" | "start") {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaign.id}/${verb}`, { method: "POST" });
      const res = await fetch(`/api/campaigns/${campaign.id}`);
      const json = await res.json();
      setCampaign(json.campaign);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 bg-[#f6f5f3] min-h-full">
      <AutoRefresher />
      <div className="mb-2">
        <Link href="/campaigns" className="text-sm text-[#9b9895] hover:text-[#1585ff] transition-colors">← Campaigns</Link>
      </div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#111110]">{campaign.name}</h1>
          <p className="mt-1 text-sm text-[#9b9895]">
            {campaign.channel} · Template: {campaign.template.name}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "DRAFT" && (
            <button onClick={() => action("start")} disabled={busy} className="rounded-lg bg-[#1585ff] hover:bg-[#0a70e0] px-3 py-1.5 text-sm text-white disabled:opacity-50 transition-colors">
              Start
            </button>
          )}
          {campaign.status === "RUNNING" && (
            <button onClick={() => action("pause")} disabled={busy} className="rounded-lg bg-amber-500 hover:bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50 transition-colors">
              Pause
            </button>
          )}
          {campaign.status === "PAUSED" && (
            <button onClick={() => action("resume")} disabled={busy} className="rounded-lg bg-[#1585ff] hover:bg-[#0a70e0] px-3 py-1.5 text-sm text-white disabled:opacity-50 transition-colors">
              Resume
            </button>
          )}
          {!["COMPLETED", "CANCELLED"].includes(campaign.status) && (
            <button onClick={() => action("cancel")} disabled={busy} className="rounded-lg border border-[#e5e3df] hover:border-[#9b9895] px-3 py-1.5 text-sm text-[#6b6866] disabled:opacity-50 transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {(["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"] as const).map((s) => (
          <div key={s} className="rounded-lg bg-white border border-[#e5e3df] px-3 py-2 text-sm">
            <span className="text-[#9b9895]">{s} </span>
            <span className={`font-semibold ${STATUS_COLORS[s]}`}>{counts[s] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-white border border-[#e5e3df] rounded-xl overflow-hidden">
        <table className="w-full text-sm text-[#6b6866]">
          <thead className="text-left text-[#9b9895] bg-[#f8f7f5]">
            <tr>
              <th className="py-3 px-5 pr-4 font-mono text-[10px] uppercase tracking-widest">Contact</th>
              <th className="pr-4 font-mono text-[10px] uppercase tracking-widest">Title</th>
              <th className="pr-4 font-mono text-[10px] uppercase tracking-widest">Company</th>
              <th className="pr-4 font-mono text-[10px] uppercase tracking-widest">Status</th>
              <th className="pr-4 font-mono text-[10px] uppercase tracking-widest">Sent</th>
              <th className="font-mono text-[10px] uppercase tracking-widest">Error</th>
            </tr>
          </thead>
          <tbody>
            {campaign.recipients.map((r) => (
              <tr key={r.id} className="border-t border-[#e5e3df] hover:bg-[#f8f7f5] transition-colors">
                <td className="py-3 px-5 pr-4 text-[#111110] font-medium">{r.contact.fullName}</td>
                <td className="pr-4">{r.contact.currentTitle ?? "—"}</td>
                <td className="pr-4">{r.contact.currentCompany ?? "—"}</td>
                <td className={`pr-4 font-medium ${STATUS_COLORS[r.status] ?? ""}`}>{r.status}</td>
                <td className="pr-4">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                <td className="text-red-500 text-xs">{r.errorMessage ?? ""}</td>
              </tr>
            ))}
            {campaign.recipients.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-[#9b9895]">No recipients yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
