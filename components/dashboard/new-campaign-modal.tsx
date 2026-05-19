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
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
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

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, templateId, contactIds }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create campaign"); return; }
      await fetch(`/api/campaigns/${json.campaign.id}/start`, { method: "POST" });
      router.push(`/campaigns/${json.campaign.id}`);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] rounded-lg border border-[#152030] bg-[#0a1422] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">New campaign</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sending to {contactIds.length} contact{contactIds.length === 1 ? "" : "s"} via LinkedIn.
        </p>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <label className="mt-4 block text-xs uppercase tracking-wide text-slate-500">Campaign name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CTO outreach May 2026"
          className="mt-1 w-full rounded bg-[#07101c] px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-[#1585ff]"
        />

        <label className="mt-4 block text-xs uppercase tracking-wide text-slate-500">Template</label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="mt-1 w-full rounded bg-[#07101c] px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#1585ff]"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {preview && (
          <div className="mt-2 rounded bg-[#07101c] p-3 text-xs text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
            {preview}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-[#152030] px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || !templateId || busy}
            className="rounded bg-[#1585ff] px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-blue-500"
          >
            {busy ? "Starting…" : "Send Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
