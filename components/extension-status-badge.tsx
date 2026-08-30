"use client";

import { useEffect, useState } from "react";

type Props = {
  lastSeenAt: string | null;
  revokedAt: string | null;
};

function getMinutesAgo(lastSeenAt: string) {
  return Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60_000);
}

export function ExtensionStatusBadge({ lastSeenAt, revokedAt }: Props) {
  const [minutesAgo, setMinutesAgo] = useState<number | null>(
    lastSeenAt ? getMinutesAgo(lastSeenAt) : null
  );

  useEffect(() => {
    if (!lastSeenAt) return;
    setMinutesAgo(getMinutesAgo(lastSeenAt));
    const id = setInterval(() => setMinutesAgo(getMinutesAgo(lastSeenAt)), 30_000);
    return () => clearInterval(id);
  }, [lastSeenAt]);

  if (revokedAt || minutesAgo === null) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--danger-soft)] text-[var(--danger)]">
        <span className="size-1.5 rounded-full bg-[var(--danger)]" />
        LinkedIn לא מחובר
      </span>
    );
  }

  const isOnline = minutesAgo < 5;
  const label = minutesAgo < 1 ? "עכשיו" : minutesAgo < 60 ? `לפני ${minutesAgo} דקות` : `לפני ${Math.floor(minutesAgo / 60)} שעות`;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isOnline ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
      <span className={`size-1.5 rounded-full ${isOnline ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`} />
      {isOnline ? "LinkedIn מחובר" : `LinkedIn לא פעיל — ${label}`}
    </span>
  );
}
