"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Template = { id: string; name: string; body: string };
type Channel = "LINKEDIN" | "WHATSAPP";

export function NewCampaignModal({
  open,
  onClose,
  contactIds,
}: {
  open: boolean;
  onClose: () => void;
  contactIds: string[];
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("LINKEDIN");
  const [dailyLimit, setDailyLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedinConnected, setLinkedinConnected] = useState<boolean | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setChannel("LINKEDIN");
    setDailyLimit(100);

    fetch("/api/linkedin/session")
      .then((r) => r.json())
      .then((d) => setLinkedinConnected(d.status === "ACTIVE"))
      .catch(() => setLinkedinConnected(false));

    fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then((d: { status: string }) => setWhatsappConnected(d.status === "CONNECTED"))
      .catch(() => setWhatsappConnected(false));

    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => {
        const tpls: Template[] = j.templates ?? [];
        setTemplates(tpls);
        if (tpls[0]) setTemplateId(tpls[0].id);
      })
      .catch(() => setError("Failed to load templates"));
  }, [open]);

  if (!open) return null;

  const preview = templates.find((t) => t.id === templateId)?.body ?? "";
  const channelNotConnected =
    (channel === "LINKEDIN" && linkedinConnected === false) ||
    (channel === "WHATSAPP" && whatsappConnected === false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          templateId,
          contactIds,
          channel,
          dailyLimit: channel === "WHATSAPP" ? dailyLimit : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create campaign"); return; }
      const startRes = await fetch(`/api/campaigns/${json.campaign.id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const startJson = await startRes.json();
        setError(startJson.message ?? startJson.error ?? "Failed to start campaign");
        return;
      }
      router.push(`/campaigns/${json.campaign.id}`);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onClose}>
      <div
        className="w-[520px] rounded-xl border border-[#e5e3df] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[#111110]">New campaign</h2>
        <p className="mt-1 text-sm text-[#9b9895]">
          Sending to {contactIds.length} contact{contactIds.length === 1 ? "" : "s"}.
        </p>

        <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Channel</label>
        <div className="mt-1 flex gap-2">
          {(["LINKEDIN", "WHATSAPP"] as Channel[]).map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                channel === c
                  ? "border-[#1585ff] bg-[#eff5ff] text-[#1585ff] font-medium"
                  : "border-[#e5e3df] text-[#6b6866] hover:border-[#9b9895]"
              }`}
            >
              {c === "LINKEDIN" ? "LinkedIn" : "WhatsApp"}
            </button>
          ))}
        </div>

        {channelNotConnected && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            {channel === "LINKEDIN" ? "LinkedIn" : "WhatsApp"} not connected.{" "}
            <a
              href={channel === "LINKEDIN" ? "/linkedin-connect" : "/whatsapp-connect"}
              className="underline hover:text-amber-800"
            >
              Connect your account →
            </a>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Campaign name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CTO outreach May 2026"
          className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-1 focus:ring-[#1585ff] focus:border-[#1585ff]/40 text-sm"
        />

        {channel === "WHATSAPP" && (
          <>
            <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Daily limit</label>
            <input
              type="number"
              min={10}
              max={500}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Math.min(500, Math.max(10, parseInt(e.target.value) || 10)))}
              className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] focus:outline-none focus:ring-1 focus:ring-[#1585ff] text-sm"
            />
            <p className="mt-1 text-xs text-[#9b9895]">Messages per day (10–500). Lower = safer from bans.</p>
          </>
        )}

        <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Template</label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] focus:outline-none focus:ring-1 focus:ring-[#1585ff] text-sm"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {preview && (
          <div className="mt-2 rounded-lg bg-[#f8f7f5] border border-[#e5e3df] p-3 text-xs text-[#6b6866] whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
            {preview}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || !templateId || busy || channelNotConnected}
            className="rounded-lg bg-[#1585ff] px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-[#0a70e0] transition-colors"
          >
            {busy ? "Starting…" : "Send Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
