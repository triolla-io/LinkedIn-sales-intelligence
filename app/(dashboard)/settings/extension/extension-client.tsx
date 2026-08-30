"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Copy, Check, Download, AlertTriangle } from "lucide-react";
import { ExtensionStatusBadge } from "@/components/extension-status-badge";
import { isExtensionOutdated } from "@/lib/extension/version";

const FOLDER_NAME = "triolla-linkedin-sender";

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
  servedVersion,
}: {
  initialSession: SessionInfo;
  /** Version of the build this deployment serves; null when it can't be read. */
  servedVersion: string | null;
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

  const sessionId = session?.id ?? null;
  const sessionRevoked = !!session?.revokedAt;
  useEffect(() => {
    if (!sessionId || sessionRevoked) return;
    const interval = setInterval(async () => {
      const s = await fetch("/api/extension/sessions").then((r) => r.json());
      if (s.session) setSession(s.session);
    }, 3000);
    return () => clearInterval(interval);
  }, [sessionId, sessionRevoked]);

  async function copyToken(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const connected = session && !session.revokedAt;
  const tokenToShow =
    rawToken ?? (connected ? `${session!.tokenPrefix}…` : null);
  // The heartbeat reports the installed version on every poll; compare it to the build
  // this deployment serves so a customer stuck on an old unpacked copy sees it here
  // instead of silently losing sends (a stale 0.4.3 wedged a whole send queue).
  const outdated =
    !!connected && isExtensionOutdated(session!.version, servedVersion);

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">
          Chrome Extension: LinkedIn Sender
        </h1>
        <ExtensionStatusBadge
          lastSeenAt={session?.lastSeenAt ?? null}
          revokedAt={session?.revokedAt ?? null}
        />
      </div>

      {(connected || servedVersion) && (
        <p className="-mt-6 text-xs text-[var(--muted)]">
          {connected && session!.version
            ? `גרסה מותקנת: ${session!.version}`
            : "גרסה מותקנת: לא ידועה"}
          {servedVersion ? ` · גרסה זמינה: ${servedVersion}` : null}
        </p>
      )}

      {outdated && (
        <output
          className="flex gap-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-sm"
        >
          <AlertTriangle className="size-5 shrink-0 text-[var(--warning)]" />
          <div className="space-y-1.5">
            <p className="font-medium text-[var(--foreground)]">
              התוסף שלך מיושן: גרסה {session!.version} מותקנת, {servedVersion} זמינה
            </p>
            <p className="text-[var(--muted)]">
              גרסאות ישנות מפספסות תיקונים ויכולות לעצור שליחות בשקט. הורידי מחדש,
              והחליפי את <strong>תוכן התיקייה הקיימת</strong> שכרום טעון ממנה, כך הנתיב
              נשמר ו-Reload יקלוט את הגרסה החדשה.
            </p>
            <Link
              href="/api/extension/download"
              download={`${FOLDER_NAME}.zip`}
              className="inline-flex items-center gap-2 text-[var(--accent)] font-medium hover:underline"
            >
              <Download className="size-4" />
              הורד את הגרסה החדשה
            </Link>
          </div>
        </output>
      )}

      {/* Steps */}
      <ol className="space-y-6 text-sm">
        {/* Step 1 */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center">
            1
          </span>
          <div className="space-y-2">
            <p className="font-medium text-[var(--foreground)]">הורידי ופרקי את ה-extension</p>
            <p className="text-[var(--muted)]">
              אחרי ההורדה, פרקי את ה-zip (דאבל-קליק). תיווצר תיקייה אחת בשם{" "}
              <code className="bg-[var(--surface-secondary)] px-1 rounded">{FOLDER_NAME}</code> עם
              הקובץ <code className="bg-[var(--surface-secondary)] px-1 rounded">manifest.json</code>{" "}
              בתוכה. זו התיקייה שתבחרי בשלב הבא.
            </p>
            <Link
              href="/api/extension/download"
              download={`${FOLDER_NAME}.zip`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--accent-strong)] transition-colors"
            >
              <Download className="size-4" />
              הורד Extension
            </Link>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center">
            2
          </span>
          <div className="space-y-1.5">
            <p className="font-medium text-[var(--foreground)]">התקיני ב-Chrome</p>
            <ol className="text-[var(--muted)] space-y-1 list-decimal list-inside">
              <li>
                פתחי{" "}
                <code className="bg-[var(--surface-secondary)] px-1 rounded">
                  chrome://extensions
                </code>{" "}
                בכרטיסייה חדשה
              </li>
              <li>
                הפעילי <strong>Developer mode</strong> (מצב מפתח) בפינה הימנית
                עליונה
              </li>
              <li>
                לחצי <strong>Load unpacked</strong> (טען מרוחס) ובחרי את התיקייה{" "}
                <code className="bg-[var(--surface-secondary)] px-1 rounded">{FOLDER_NAME}</code> שפרקת
              </li>
              <li>
                אמתי שהגרסה שמופיעה בכרטיס התוסף היא{" "}
                <strong>{servedVersion ?? "העדכנית"}</strong>
              </li>
            </ol>
            <p className="text-[var(--muted)]">
              <strong>בעדכון גרסה:</strong> החליפי את התוכן של אותה תיקייה ולחצי Reload
              (🔄). אם תפרקי לתיקייה חדשה, כרום ימשיך לטעון את הישנה, ואז או שתבחרי
              Load unpacked על החדשה <em>ותסירי את הרשומה הישנה</em>, או שתעבירי את
              הקבצים לנתיב הקיים.
            </p>
          </div>
        </li>

        {/* Step 3 — Token */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center">
            3
          </span>
          <div className="space-y-2 flex-1">
            <p className="font-medium text-[var(--foreground)]">חברי את ה-extension</p>
            {!connected ? (
              <div className="space-y-2">
                <p className="text-[var(--muted)]">
                  יצרי token ואז הדביקי אותו בחלון ה-extension.
                </p>
                <button
                  type="button"
                  onClick={createToken}
                  disabled={busy}
                  className="px-4 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--accent-strong)] transition-colors disabled:opacity-50"
                >
                  {busy ? "יוצר…" : "צרי token חדש"}
                </button>
              </div>
            ) : null}
            {tokenToShow && (
              <div
                className={`rounded-lg border px-3 py-2 space-y-1 ${rawToken ? "bg-[var(--warning-soft)] border-[var(--warning-soft)]" : "bg-[var(--surface-secondary)] border-[var(--line)]"}`}
              >
                {rawToken && (
                  <p className="text-xs text-[var(--warning)] font-medium">
                    העתיקי עכשיו, לא יוצג שוב
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs break-all text-[var(--foreground)]">
                    {tokenToShow}
                  </code>
                  {rawToken && (
                    <button
                      type="button"
                      onClick={() => copyToken(rawToken)}
                      aria-label="העתקי token"
                      className="shrink-0 text-[var(--accent)] hover:text-[var(--accent-strong)]"
                    >
                      {copied ? (
                        <Check className="size-4 text-[var(--success)]" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
            {connected && !rawToken && (
              <p className="text-[var(--muted)]">
                Token פעיל. ה-extension מחובר ועובד ב-background.
              </p>
            )}
          </div>
        </li>

        {/* Step 4 */}
        <li className="flex gap-4">
          <span className="shrink-0 size-7 rounded-full bg-[var(--line)] text-[var(--muted)] text-xs font-bold flex items-center justify-center">
            4
          </span>
          <div className="space-y-1.5">
            <p className="font-medium text-[var(--foreground)]">השאירי Chrome פתוח</p>
            <p className="text-[var(--muted)]">
              ה-extension עובד ב-background ושולח הודעות בזמן שהמחשב דלוק.
              Chrome חייב להיות פתוח עם חשבון LinkedIn מחובר.
            </p>
          </div>
        </li>
      </ol>

      {/* Revoke */}
      {connected && (
        <div className="border-t border-[var(--line)] pt-4">
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="px-3 py-1.5 text-sm text-[var(--danger)] border border-[var(--danger-soft)] rounded-lg hover:bg-[var(--danger-soft)] transition-colors disabled:opacity-50"
          >
            בטל token
          </button>
        </div>
      )}
    </div>
  );
}
