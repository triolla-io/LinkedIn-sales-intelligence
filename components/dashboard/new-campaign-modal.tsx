"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";

type Template = { id: string; name: string; body: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type FormState = {
  name: string;
  templateId: string;
  channel: "WHATSAPP" | "EMAIL" | "LINKEDIN";
  subject: string;
  error: string | null;
};
type FormAction =
  | { type: "fieldChanged"; name: "name" | "templateId" | "subject"; value: string }
  | { type: "channelSet"; value: "WHATSAPP" | "EMAIL" | "LINKEDIN" }
  | { type: "errorSet"; value: string | null }
  | { type: "reset" };
function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "fieldChanged":
      return { ...state, [action.name]: action.value };
    case "channelSet":
      return { ...state, channel: action.value };
    case "errorSet":
      return { ...state, error: action.value };
    case "reset":
      return { name: "", templateId: "", channel: "WHATSAPP", subject: "", error: null };
  }
}

export function NewCampaignModal({
  open,
  onClose,
  contactIds,
}: {
  open: boolean;
  onClose: () => void;
  contactIds: string[];
}) {
  const [form, dispatch] = useReducer(formReducer, {
    name: "",
    templateId: "",
    channel: "WHATSAPP" as const,
    subject: "",
    error: null as string | null,
  });
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const prevOpen = useRef(open);
  if (open !== prevOpen.current) {
    prevOpen.current = open;
    if (open) dispatch({ type: "reset" });
  }

  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  });

  const { data: whatsappData, error: whatsappErr } = useSWR(open ? "/api/whatsapp/status" : null, fetcher);
  const whatsappConnected = whatsappErr ? false : (whatsappData ? whatsappData.status === "CONNECTED" : null);

  const { data: gmailData, error: gmailErr } = useSWR(open ? "/api/gmail/status" : null, fetcher);
  const gmailConnected = gmailErr ? false : (gmailData ? gmailData.connected : null);

  const { data: extData, error: extErr } = useSWR(open ? "/api/extension/sessions" : null, fetcher);
  const extensionConnected = extErr ? false : (extData?.session && !extData.session.revokedAt ? (Date.now() - (extData.session.lastSeenAt ? new Date(extData.session.lastSeenAt).getTime() : 0) < 10 * 60 * 1000) : (extData ? false : null));

  const { data: tplData } = useSWR(open ? "/api/templates" : null, fetcher);
  const templates: Template[] = tplData ? (Array.isArray(tplData) ? tplData : (tplData.templates ?? [])) : [];
  const effectiveTemplateId = form.templateId || templates[0]?.id || "";

  if (!open) return null;

  const preview = templates.find((t) => t.id === effectiveTemplateId)?.body ?? "";

  async function submit() {
    setBusy(true);
    dispatch({ type: "errorSet", value: null });
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          templateId: effectiveTemplateId,
          contactIds,
          channel: form.channel,
          ...(form.channel === "EMAIL" ? { subject: form.subject } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        dispatch({ type: "errorSet", value: json.error ?? "Failed to create campaign" });
        return;
      }
      const startRes = await fetch(`/api/campaigns/${json.campaign.id}/start`, {
        method: "POST",
      });
      if (!startRes.ok) {
        const startJson = await startRes.json();
        dispatch({
          type: "errorSet",
          value: startJson.message ?? startJson.error ?? "Failed to start campaign",
        });
        return;
      }
      router.push(`/campaigns/${json.campaign.id}`);
    } catch {
      dispatch({ type: "errorSet", value: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[520px] rounded-xl border border-[#e5e3df] bg-white p-6 shadow-xl backdrop:bg-black/20"
    >
        <h2 className="text-lg font-semibold text-[#111110]">New campaign</h2>
        <p className="mt-1 text-sm text-[#9b9895]">
          Sending to {contactIds.length} contact
          {contactIds.length === 1 ? "" : "s"}.
        </p>

        {/* Channel selector */}
        <div className="mt-4 flex rounded-lg border border-[#e5e3df] overflow-hidden text-sm">
          {(["WHATSAPP", "EMAIL", "LINKEDIN"] as const).map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => dispatch({ type: "channelSet", value: ch })}
              className={`flex-1 py-1.5 font-medium transition-colors ${
                form.channel === ch
                  ? "bg-[#111110] text-white"
                  : "bg-white text-[#6b6866] hover:text-[#111110]"
              }`}
            >
              {ch === "WHATSAPP"
                ? "WhatsApp"
                : ch === "EMAIL"
                  ? "Email"
                  : "LinkedIn"}
            </button>
          ))}
        </div>

        {form.channel === "WHATSAPP" && whatsappConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            WhatsApp not connected.{" "}
            <Link
              href="/whatsapp-connect"
              className="underline hover:text-amber-800"
            >
              Connect your account →
            </Link>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}
        {form.channel === "EMAIL" && gmailConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            Gmail not authorized.{" "}
            <Link
              href="/api/auth/signin"
              className="underline hover:text-amber-800"
            >
              Re-authorize your Google account →
            </Link>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}
        {form.channel === "LINKEDIN" && extensionConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            Chrome extension not connected.{" "}
            <Link
              href="/settings/extension"
              className="underline hover:text-amber-800"
            >
              Set up the extension →
            </Link>{" "}
            Keep Chrome open during sending.
          </div>
        )}

        {form.error && <p className="mt-3 text-sm text-red-500">{form.error}</p>}

        <label htmlFor="campaign-name" className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">
          Campaign name
        </label>
        <input
          id="campaign-name"
          value={form.name}
          onChange={(e) => dispatch({ type: "fieldChanged", name: "name", value: e.target.value })}
          placeholder="e.g. CTO outreach May 2026"
          className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-1 focus:ring-[#1585ff] focus:border-[#1585ff]/40 text-sm"
        />

        {form.channel === "EMAIL" && (
          <>
            <label htmlFor="email-subject" className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">
              Email subject
            </label>
            <input
              id="email-subject"
              value={form.subject}
              onChange={(e) => dispatch({ type: "fieldChanged", name: "subject", value: e.target.value })}
              placeholder="e.g. Quick question about your team"
              className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-1 focus:ring-[#1585ff] focus:border-[#1585ff]/40 text-sm"
            />
          </>
        )}

        <label htmlFor="campaign-template" className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">
          Template
        </label>
        <select
          id="campaign-template"
          value={effectiveTemplateId}
          onChange={(e) => dispatch({ type: "fieldChanged", name: "templateId", value: e.target.value })}
          className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] focus:outline-none focus:ring-1 focus:ring-[#1585ff] text-sm"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {preview && (
          <div className="mt-2 rounded-lg bg-[#f8f7f5] border border-[#e5e3df] p-3 text-xs text-[#6b6866] whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
            {preview}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={
              !form.name.trim() ||
              !effectiveTemplateId ||
              busy ||
              (form.channel === "WHATSAPP" && whatsappConnected === false) ||
              (form.channel === "EMAIL" &&
                (!form.subject.trim() || gmailConnected === false)) ||
              (form.channel === "LINKEDIN" && extensionConnected === false)
            }
            className="rounded-lg bg-[#1585ff] px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-[#0a70e0] transition-colors"
          >
            {busy ? "Starting…" : "Send Campaign"}
          </button>
        </div>
    </dialog>
  );
}
