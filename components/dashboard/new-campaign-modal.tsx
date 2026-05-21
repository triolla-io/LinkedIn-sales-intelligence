"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Template = { id: string; name: string; body: string };

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(null);
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [subject, setSubject] = useState("");
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setChannel("WHATSAPP");
    setSubject("");

    fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then((d: { status: string }) => setWhatsappConnected(d.status === "CONNECTED"))
      .catch(() => setWhatsappConnected(false));

    fetch("/api/gmail/status")
      .then((r) => r.json())
      .then((d: { connected: boolean }) => setGmailConnected(d.connected))
      .catch(() => setGmailConnected(false));

    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => {
        const tpls: Template[] = Array.isArray(j) ? j : (j.templates ?? []);
        setTemplates(tpls);
        if (tpls[0]) setTemplateId(tpls[0].id);
      })
      .catch(() => setError("Failed to load templates"));
  }, [open]);

  if (!open) return null;

  const preview = templates.find((t) => t.id === templateId)?.body ?? "";

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
          ...(channel === "EMAIL" ? { subject } : {}),
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

        {/* Channel selector */}
        <div className="mt-4 flex rounded-lg border border-[#e5e3df] overflow-hidden text-sm">
          {(["WHATSAPP", "EMAIL"] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`flex-1 py-1.5 font-medium transition-colors ${
                channel === ch
                  ? "bg-[#111110] text-white"
                  : "bg-white text-[#6b6866] hover:text-[#111110]"
              }`}
            >
              {ch === "WHATSAPP" ? "WhatsApp" : "Email"}
            </button>
          ))}
        </div>

        {channel === "WHATSAPP" && whatsappConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            WhatsApp not connected.{" "}
            <a href="/whatsapp-connect" className="underline hover:text-amber-800">
              Connect your account →
            </a>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}
        {channel === "EMAIL" && gmailConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            Gmail not authorized.{" "}
            <a href="/api/auth/signin" className="underline hover:text-amber-800">
              Re-authorize your Google account →
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

        {channel === "EMAIL" && (
          <>
            <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Email subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Quick question about your team"
              className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-1 focus:ring-[#1585ff] focus:border-[#1585ff]/40 text-sm"
            />
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
            disabled={
              !name.trim() ||
              !templateId ||
              busy ||
              (channel === "WHATSAPP" && whatsappConnected === false) ||
              (channel === "EMAIL" && (!subject.trim() || gmailConnected === false))
            }
            className="rounded-lg bg-[#1585ff] px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-[#0a70e0] transition-colors"
          >
            {busy ? "Starting…" : "Send Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
