"use client";

type Props = {
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export function ExtensionStatusBadge({ lastSeenAt, revokedAt }: Props) {
  if (revokedAt || !lastSeenAt) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#fff3f3] text-[#dc2626]">
        <span className="size-1.5 rounded-full bg-[#dc2626]" />
        LinkedIn לא מחובר
      </span>
    );
  }
  const minutesAgo = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60_000);
  const isOnline = minutesAgo < 5;
  const label = minutesAgo < 1 ? "עכשיו" : minutesAgo < 60 ? `לפני ${minutesAgo} דקות` : `לפני ${Math.floor(minutesAgo / 60)} שעות`;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isOnline ? "bg-[#e6faf0] text-[#059669]" : "bg-[#fff7e6] text-[#b45309]"}`}>
      <span className={`size-1.5 rounded-full ${isOnline ? "bg-[#059669]" : "bg-[#b45309]"}`} />
      {isOnline ? "LinkedIn מחובר" : `LinkedIn לא פעיל — ${label}`}
    </span>
  );
}
