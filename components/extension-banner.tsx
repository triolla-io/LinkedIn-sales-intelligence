"use client";
import useSWR from "swr";

type Alert = { id: string; kind: "OFFLINE" | "CHECKPOINT"; message: string };

const fetcher = (url: string) => fetch(url).then(r => r.json()).catch(() => ({ alerts: [] }));

export function ExtensionBanner() {
  const { data } = useSWR<{ alerts: Alert[] }>("/api/extension/alerts", fetcher, { refreshInterval: 60000 });
  const alerts = data?.alerts ?? [];

  if (alerts.length === 0) return null;

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm">
      {alerts.map(a => (
        <div key={a.id}>
          <strong>{a.kind === "OFFLINE" ? "Extension offline" : "LinkedIn checkpoint"}:</strong>{" "}
          {a.message}
        </div>
      ))}
    </div>
  );
}
