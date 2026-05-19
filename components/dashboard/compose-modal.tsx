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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Send Message</h2>
            <p className="text-sm text-gray-500">To: {contact.fullName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Impersonation notice */}
          {impersonatedUserName && (
            <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-md">
              <span className="text-sm text-yellow-800">
                Sending as <strong>{impersonatedUserName}</strong>
              </span>
            </div>
          )}

          {/* Template picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Template (optional)
            </label>
            <TemplatePicker onSelect={handleTemplateSelect} />
          </div>

          {/* Message body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Type your message..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
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
            <p className="text-sm text-green-600 font-medium">Message queued successfully!</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={loading || isRateLimited || sent}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              loading || isRateLimited || sent
                ? "bg-blue-400 text-white cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            )}
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {sent ? "Sent!" : "Send Message"}
          </button>
        </div>
      </div>
    </div>
  );
}
