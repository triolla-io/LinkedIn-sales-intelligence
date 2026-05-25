"use client";

import { useState } from "react";
import { X, Send, RefreshCw } from "lucide-react";
import TemplatePicker from "./template-picker";
import RateLimitCountdown from "./rate-limit-countdown";
import type { Contact } from "./contact-table";
import { cn } from "@/lib/cn";

interface ComposeModalProps {
  contact: Contact | null;
  onClose: () => void;
  impersonatedUserName?: string | null;
}

export default function ComposeModal({ contact, onClose, impersonatedUserName }: ComposeModalProps) {
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);

  function handleTemplateSelect(template: { id: string; body: string; name: string }) {
    setTemplateId(template.id);
    setBody(template.body);
  }

  async function handleSend() {
    if (!body.trim()) {
      setError("גוף ההודעה הוא שדה חובה");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: contact!.id,
          ...(templateId ? { templateId } : {}),
          body,
        }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setRateLimitSeconds(data.retryAfter ?? 60);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "שליחת ההודעה נכשלה");
        return;
      }

      setSent(true);
      setTimeout(onClose, 1500);
    } catch {
      setError("שגיאת רשת. אנא נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  const isRateLimited = rateLimitSeconds !== null && rateLimitSeconds > 0;

  if (!contact) return null;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-[#e5e3df] rounded-xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e3df]">
          <div>
            <h2 className="font-semibold text-[#111110] text-sm">שלח הודעה</h2>
            <p className="text-xs text-[#9b9895] mt-0.5">אל: {contact.fullName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#9b9895] hover:text-[#6b6866] hover:bg-[#f3f2ef] p-1.5 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Impersonation notice */}
          {impersonatedUserName && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
              <span className="text-xs text-amber-700">
                שולח בתור <strong>{impersonatedUserName}</strong>
              </span>
            </div>
          )}

          {/* Template picker */}
          <div>
            <label className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">
              תבנית (אופציונלי)
            </label>
            <TemplatePicker onSelect={handleTemplateSelect} />
          </div>

          {/* Message body */}
          <div>
            <label className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">
              הודעה
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="כתוב את ההודעה שלך..."
              dir="rtl"
              className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-lg px-3 py-2.5 text-sm text-[#111110] placeholder-[#c8c5c2] resize-none focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors font-mono leading-relaxed"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
              {error}
            </p>
          )}

          {/* Rate limit */}
          {isRateLimited && (
            <RateLimitCountdown
              seconds={rateLimitSeconds!}
              onExpired={() => setRateLimitSeconds(null)}
            />
          )}

          {/* Success */}
          {sent && (
            <p className="text-xs text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200 font-medium">
              ההודעה נוספה לתור!
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#e5e3df]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] hover:bg-[#f3f2ef] rounded-lg transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={handleSend}
            disabled={loading || isRateLimited || sent}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              loading || isRateLimited || sent
                ? "bg-[#1585ff]/50 text-white/70 cursor-not-allowed"
                : "bg-[#1585ff] text-white hover:bg-[#0a70e0]"
            )}
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {sent ? "נשלח!" : "שלח"}
          </button>
        </div>
      </div>
    </div>
  );
}
