"use client";
import { useEffect, useState } from "react";

type Alert = { id: string; kind: "OFFLINE" | "CHECKPOINT"; message: string };

export function ExtensionBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    let stop = false;
    async function tick() {
      const r = await fetch("/api/extension/alerts")
        .then(r => r.json())
        .catch(() => ({ alerts: [] }));
      if (!stop) setAlerts(r.alerts ?? []);
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

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
