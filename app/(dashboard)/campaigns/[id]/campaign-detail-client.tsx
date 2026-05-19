"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

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
  PENDING: "text-slate-400",
  SENDING: "text-blue-400",
  SENT: "text-green-400",
  FAILED: "text-red-400",
  SKIPPED: "text-amber-400",
};

export function CampaignDetailClient({ initial }: { initial: Campaign }) {
  const [campaign, setCampaign] = useState<Campaign>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/linkedin/events");
    es.addEventListener("message", async (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data as string);
        if (payload.type === "campaign:sent" && payload.data.campaignId === campaign.id) {
          const res = await fetch(`/api/campaigns/${campaign.id}`);
          const json = await res.json();
          setCampaign(json.campaign);
        }
      } catch { /* ignore malformed events */ }
    });
    return () => es.close();
  }, [campaign.id]);

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
    <div className="p-8">
      <div className="mb-2">
        <Link href="/campaigns" className="text-sm text-slate-500 hover:text-white">← Campaigns</Link>
      </div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{campaign.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {campaign.channel} · Template: {campaign.template.name}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "DRAFT" && (
            <button onClick={() => action("start")} disabled={busy} className="rounded bg-[#1585ff] px-3 py-1.5 text-sm text-white disabled:opacity-50">
              Start
            </button>
          )}
          {campaign.status === "RUNNING" && (
            <button onClick={() => action("pause")} disabled={busy} className="rounded bg-[#f0a928] px-3 py-1.5 text-sm text-white disabled:opacity-50">
              Pause
            </button>
          )}
          {campaign.status === "PAUSED" && (
            <button onClick={() => action("resume")} disabled={busy} className="rounded bg-[#1585ff] px-3 py-1.5 text-sm text-white disabled:opacity-50">
              Resume
            </button>
          )}
          {!["COMPLETED", "CANCELLED"].includes(campaign.status) && (
            <button onClick={() => action("cancel")} disabled={busy} className="rounded border border-[#152030] px-3 py-1.5 text-sm text-slate-300 disabled:opacity-50">
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {(["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"] as const).map((s) => (
          <div key={s} className="rounded bg-[#0a1422] border border-[#152030] px-3 py-2 text-sm">
            <span className="text-slate-500">{s} </span>
            <span className={`font-semibold ${STATUS_COLORS[s]}`}>{counts[s] ?? 0}</span>
          </div>
        ))}
      </div>

      <table className="mt-6 w-full text-sm text-slate-300">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-2 pr-4">Contact</th>
            <th className="pr-4">Title</th>
            <th className="pr-4">Company</th>
            <th className="pr-4">Status</th>
            <th>Sent</th>
          </tr>
        </thead>
        <tbody>
          {campaign.recipients.map((r) => (
            <tr key={r.id} className="border-t border-[#152030]">
              <td className="py-2 pr-4">{r.contact.fullName}</td>
              <td className="pr-4">{r.contact.currentTitle ?? "—"}</td>
              <td className="pr-4">{r.contact.currentCompany ?? "—"}</td>
              <td className={`pr-4 font-medium ${STATUS_COLORS[r.status] ?? ""}`}>{r.status}</td>
              <td>{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
            </tr>
          ))}
          {campaign.recipients.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate-500">No recipients yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
