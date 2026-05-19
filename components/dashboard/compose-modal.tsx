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
      setError("Message body is required");
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
        setError(data.error ?? "Failed to send message");
        return;
      }

      setSent(true);
      setTimeout(onClose, 1500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const isRateLimited = rateLimitSeconds !== null && rateLimitSeconds > 0;

  if (!contact) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a1422] border border-[#1a2d40] rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#152030]">
          <div>
            <h2 className="font-semibold text-white text-sm">Send Message</h2>
            <p className="text-xs text-[#5b7fa6] mt-0.5">To: {contact.fullName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#5b7fa6] hover:text-white hover:bg-[#152030] p-1.5 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Impersonation notice */}
          {impersonatedUserName && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#f0a928]/10 border border-[#f0a928]/20 rounded-lg">
              <span className="text-xs text-[#f0a928]">
                Sending as <strong>{impersonatedUserName}</strong>
              </span>
            </div>
          )}

          {/* Template picker */}
          <div>
            <label className="block text-[11px] font-semibold text-[#5b7fa6] uppercase tracking-widest mb-2">
              Template (optional)
            </label>
            <TemplatePicker onSelect={handleTemplateSelect} />
          </div>

          {/* Message body */}
          <div>
            <label className="block text-[11px] font-semibold text-[#5b7fa6] uppercase tracking-widest mb-2">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Type your message..."
              className="w-full bg-[#07101c] border border-[#1a2d40] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#2d4a62] resize-none focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors font-mono leading-relaxed"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg border border-red-400/20">
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
            <p className="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg border border-emerald-400/20 font-medium">
              Message queued successfully!
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#152030]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#5b7fa6] hover:text-white hover:bg-[#152030] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={loading || isRateLimited || sent}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              loading || isRateLimited || sent
                ? "bg-[#1585ff]/50 text-white/70 cursor-not-allowed"
                : "bg-[#1585ff] text-white hover:bg-[#1070d9]"
            )}
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {sent ? "Sent!" : "Send Message"}
          </button>
        </div>
      </div>
    </div>
  );
}
