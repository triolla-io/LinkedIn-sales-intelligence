"use client";
import useSWR from "swr";

type Alert = { id: string; kind: "OFFLINE" | "CHECKPOINT"; message: string };

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .catch(() => ({ alerts: [] }));

const KIND_LABEL: Record<Alert["kind"], string> = {
  OFFLINE: "התוסף לא מחובר",
  CHECKPOINT: "לינקדאין ביקש אימות",
};

export function ExtensionBanner() {
  const { data } = useSWR<{ alerts: Alert[] }>("/api/extension/alerts", fetcher, {
    refreshInterval: 60000,
  });
  const alerts = data?.alerts ?? [];

  if (alerts.length === 0) return null;

  return (
    <div
      dir="rtl"
      role="status"
      className="border-b border-[var(--warning)]/30 bg-[var(--warning-soft)] px-4 py-2 text-sm text-[var(--warning)]"
    >
      {alerts.map((a) => (
        <div key={a.id} className="flex flex-wrap items-baseline gap-x-1.5">
          <strong className="font-semibold">{KIND_LABEL[a.kind]}:</strong>
          {/* dir="auto" + בידוד: רשומות ישנות בבסיס הנתונים עדיין באנגלית,
              ובלי זה הנקודה שלהן קופצת לתחילת השורה. */}
          <span dir="auto" className="bidi-isolate">
            {a.message}
          </span>
        </div>
      ))}
    </div>
  );
}
