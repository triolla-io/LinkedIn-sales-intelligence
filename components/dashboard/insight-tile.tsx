"use client";

import { cn } from "@/lib/cn";

interface InsightTileProps {
  title: string;
  value: string | number;
  onClick?: () => void;
  clickable?: boolean;
}

export default function InsightTile({ title, value, onClick, clickable }: InsightTileProps) {
  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={cn(
        "bg-white border border-gray-200 rounded-lg p-4",
        clickable && "cursor-pointer hover:bg-gray-50 transition-colors"
      )}
    >
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{title}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
