"use client";
import { useState } from "react";

type SessionInfo = {
  id: string;
  tokenPrefix: string;
  lastSeenAt: string | null;
  version: string | null;
  revokedAt: string | null;
  createdAt: string;
} | null;

export function ExtensionClient({ initialSession }: { initialSession: SessionInfo }) {
  const [session, setSession] = useState(initialSession);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createToken() {
    setBusy(true);
    const res = await fetch("/api/extension/sessions", { method: "POST" });
    const body = await res.json();
    if (res.ok) {
      setRawToken(body.token);
      const s = await fetch("/api/extension/sessions").then(r => r.json());
      setSession(s.session);
    } else {
      alert(body.message ?? body.error);
    }
    setBusy(false);
  }

  async function revoke() {
    if (!session || !confirm("Revoke this token?")) return;
    setBusy(true);
    await fetch(`/api/extension/sessions/${session.id}`, { method: "DELETE" });
    setSession(null);
    setRawToken(null);
    setBusy(false);
  }

  const connected = session && !session.revokedAt;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Chrome Extension</h1>

      <section>
        <h2 className="font-medium mb-2">Status</h2>
        {connected ? (
          <p className="text-sm text-gray-700">
            Token <code>{session!.tokenPrefix}…</code> · Last seen{" "}
            {session!.lastSeenAt ? new Date(session!.lastSeenAt).toLocaleString() : "never"}
          </p>
        ) : (
          <p className="text-sm text-gray-500">No active token.</p>
        )}
      </section>

      {rawToken && (
        <section className="bg-yellow-50 border border-yellow-200 p-3 rounded">
          <p className="text-sm font-medium mb-2">Copy your token now — it won&apos;t be shown again:</p>
          <code className="block break-all bg-white p-2 text-xs">{rawToken}</code>
        </section>
      )}

      <div className="space-x-2">
        {!connected && (
          <button onClick={createToken} disabled={busy} className="px-3 py-1 rounded bg-blue-600 text-white text-sm">
            Generate token
          </button>
        )}
        {connected && (
          <button onClick={revoke} disabled={busy} className="px-3 py-1 rounded bg-red-600 text-white text-sm">
            Revoke
          </button>
        )}
      </div>

      <section className="text-sm text-gray-600 space-y-1">
        <p>1. Install the Chrome extension (load <code>extension/dist</code> as unpacked).</p>
        <p>2. Click the extension icon, paste the token, click Connect.</p>
        <p>3. Keep Chrome open during working hours — extension polls every 30s.</p>
      </section>
    </div>
  );
}
