"use client";

import { cn } from "@/lib/cn";

type InsightsData = {
  total: number;
  bySeniority: Record<string, number>;
  byFunction: Record<string, number>;
  topCompanies: { name: string; count: number }[];
  companySizeHistogram: { bucket: string; count: number }[];
  coverage: { email: number; phone: number };
};

interface StatsBarProps {
  insights: InsightsData;
  newThisWeek: number;
  onFilterCLevel: () => void;
}

interface StatProps {
  label: string;
  value: string | number;
  sub?: string;
  clickable?: boolean;
  onClick?: () => void;
  accent?: "blue" | "amber" | "neutral";
}

function Stat({ label, value, sub, clickable, onClick, accent = "neutral" }: StatProps) {
  const valueColor = {
    blue: "text-[#1585ff]",
    amber: "text-amber-600",
    neutral: "text-[#111110]",
  }[accent];

  return (
    <button
      onClick={clickable ? onClick : undefined}
      className={cn(
        "flex flex-col px-5 py-3 border-r border-[#e5e3df] last:border-0 min-w-0 shrink-0",
        clickable && "hover:bg-[#f8f7f5] transition-colors cursor-pointer"
      )}
      style={{ cursor: clickable ? "pointer" : "default" }}
    >
      <span className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest whitespace-nowrap">
        {label}
      </span>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className={cn("text-2xl font-semibold font-mono tabular-nums leading-none", valueColor)}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {sub && <span className="text-[10px] text-[#9b9895] font-mono">{sub}</span>}
      </div>
    </button>
  );
}

export default function StatsBar({ insights, newThisWeek, onFilterCLevel }: StatsBarProps) {
  const cLevel = insights.bySeniority["C_LEVEL"] ?? 0;
  const reachable = Math.round(
    insights.total * (1 - (1 - insights.coverage.email / 100) * (1 - insights.coverage.phone / 100))
  );

  return (
    <div className="flex items-stretch bg-white border border-[#e5e3df] rounded-lg overflow-hidden shrink-0">
      <Stat label="סה״כ" value={insights.total} />
      <Stat
        label="ניתן להשגה"
        value={reachable}
        sub={`${Math.round((reachable / Math.max(insights.total, 1)) * 100)}%`}
        accent="blue"
      />
      <Stat
        label="דירוג C"
        value={cLevel}
        sub={cLevel > 0 ? `${Math.round((cLevel / insights.total) * 100)}%` : undefined}
        clickable
        onClick={onFilterCLevel}
        accent="amber"
      />
      <Stat label="חדש השבוע" value={newThisWeek} accent="neutral" />
    </div>
  );
}
