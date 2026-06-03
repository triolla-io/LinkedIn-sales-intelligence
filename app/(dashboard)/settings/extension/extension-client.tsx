"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Copy, Check, Download } from "lucide-react";
import { ExtensionStatusBadge } from "@/components/extension-status-badge";

type SessionInfo = {
  id: string;
  tokenPrefix: string;
  lastSeenAt: string | null;
  version: string | null;
  revokedAt: string | null;
  createdAt: string;
} | null;

export function ExtensionClient({
  initialSession,
}: {
  initialSession: SessionInfo;
}) {
  const [session, setSession] = useState(initialSession);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function createToken() {
    setBusy(true);
    const res = await fetch("/api/extension/sessions", { method: "POST" });
    const body = await res.json();
    if (res.ok) {
      setRawToken(body.token);
      const s = await fetch("/api/extension/sessions").then((r) => r.json());
      setSession(s.session);
    } else {
      alert(body.message ?? body.error);
    }
    setBusy(false);
  }

  async function revoke() {
    if (!session || !confirm("לבטל את ה-token? ה-extension יתנתק.")) return;
    setBusy(true);
    await fetch(`/api/extension/sessions/${session.id}`, { method: "DELETE" });
    setSession(null);
    setRawToken(null);
    setBusy(false);
  }

  useEffect(() => {
    if (!session || session.revokedAt) return;
    const interval = setInterval(async () => {
      const s = await fetch("/api/extension/sessions").then((r) => r.json());
      if (s.session) setSession(s.session);
    }, 8000);
    return () => clearInterval(interval);
  }, [session?.id, session?.revokedAt]);

  async function copyToken(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const connected = session && !session.revokedAt;
  const tokenToShow =
    rawToken ?? (connected ? `${session!.tokenPrefix}…` : null);

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#111110]">
          Chrome Extension: LinkedIn Sender
        </h1>
        <ExtensionStatusBadge
          lastSeenAt={session?.lastSeenAt ?? null}
          revokedAt={session?.revokedAt ?? null}
        />
      </div>

      {/* Steps */}
      <ol className="space-y-6 text-sm">
        {/* Step 1 */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[#1585ff] text-white text-xs font-bold flex items-center justify-center">
            1
          </span>
          <div className="space-y-2">
            <p className="font-medium text-[#111110]">הורידי את ה-extension</p>
            <Link
              href="/api/extension/download"
              download="triolla-linkedin-sender.zip"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors"
            >
              <Download className="size-4" />
              הורד Extension
            </Link>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[#1585ff] text-white text-xs font-bold flex items-center justify-center">
            2
          </span>
          <div className="space-y-1.5">
            <p className="font-medium text-[#111110]">התקיני ב-Chrome</p>
            <ol className="text-[#6b6866] space-y-1 list-decimal list-inside">
              <li>
                פתחי{" "}
                <code className="bg-[#f3f2ef] px-1 rounded">
                  chrome://extensions
                </code>{" "}
                בכרטיסייה חדשה
              </li>
              <li>
                הפעילי <strong>Developer mode</strong> (מצב מפתח) בפינה הימנית
                עליונה
              </li>
              <li>
                לחצי <strong>Load unpacked</strong> (טען מרוחס) ובחרי את תיקיית
                ה-extension
              </li>
            </ol>
          </div>
        </li>

        {/* Step 3 — Token */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[#1585ff] text-white text-xs font-bold flex items-center justify-center">
            3
          </span>
          <div className="space-y-2 flex-1">
            <p className="font-medium text-[#111110]">חברי את ה-extension</p>
            {!connected ? (
              <div className="space-y-2">
                <p className="text-[#6b6866]">
                  יצרי token ואז הדביקי אותו בחלון ה-extension.
                </p>
                <button
                  type="button"
                  onClick={createToken}
                  disabled={busy}
                  className="px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors disabled:opacity-50"
                >
                  {busy ? "יוצר…" : "צרי token חדש"}
                </button>
              </div>
            ) : null}
            {tokenToShow && (
              <div
                className={`rounded-lg border px-3 py-2 space-y-1 ${rawToken ? "bg-[#fffbeb] border-[#fcd34d]" : "bg-[#f3f2ef] border-[#e5e3df]"}`}
              >
                {rawToken && (
                  <p className="text-xs text-[#b45309] font-medium">
                    העתיקי עכשיו, לא יוצג שוב
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs break-all text-[#111110]">
                    {tokenToShow}
                  </code>
                  {rawToken && (
                    <button
                      type="button"
                      onClick={() => copyToken(rawToken)}
                      className="shrink-0 text-[#1585ff] hover:text-[#0f6fd4]"
                    >
                      {copied ? (
                        <Check className="size-4 text-[#059669]" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
            {connected && !rawToken && (
              <p className="text-[#6b6866]">
                Token פעיל. ה-extension מחובר ועובד ב-background.
              </p>
            )}
          </div>
        </li>

        {/* Step 4 */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[#e5e3df] text-[#6b6866] text-xs font-bold flex items-center justify-center">
            4
          </span>
          <div className="space-y-1.5">
            <p className="font-medium text-[#111110]">השאירי Chrome פתוח</p>
            <p className="text-[#6b6866]">
              ה-extension עובד ב-background ושולח הודעות בזמן שהמחשב דלוק.
              Chrome חייב להיות פתוח עם חשבון LinkedIn מחובר.
            </p>
          </div>
        </li>
      </ol>

      {/* Revoke */}
      {connected && (
        <div className="border-t border-[#e5e3df] pt-4">
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="px-3 py-1.5 text-sm text-[#dc2626] border border-[#fecaca] rounded-lg hover:bg-[#fff3f3] transition-colors disabled:opacity-50"
          >
            בטל token
          </button>
        </div>
      )}
    </div>
  );
}
