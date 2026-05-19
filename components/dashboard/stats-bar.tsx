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
  accent?: "blue" | "amber" | "white";
}

function Stat({ label, value, sub, clickable, onClick, accent = "white" }: StatProps) {
  const valueColor = {
    blue: "text-[#1585ff]",
    amber: "text-[#f0a928]",
    white: "text-[#eaf2fd]",
  }[accent];

  return (
    <button
      onClick={clickable ? onClick : undefined}
      className={cn(
        "flex flex-col px-5 py-3 border-r border-[#1e3248] last:border-0 min-w-0 shrink-0",
        clickable && "hover:bg-[#1c3048] transition-colors cursor-pointer"
      )}
      style={{ cursor: clickable ? "pointer" : "default" }}
    >
      <span className="text-[10px] font-mono text-[#456078] uppercase tracking-widest whitespace-nowrap">
        {label}
      </span>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className={cn("text-2xl font-semibold font-mono tabular-nums leading-none", valueColor)}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {sub && <span className="text-[10px] text-[#5c7d9e] font-mono">{sub}</span>}
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
    <div className="flex items-stretch bg-[#162333] border border-[#1e3248] rounded-lg overflow-hidden shrink-0">
      <Stat label="Total" value={insights.total} />
      <Stat
        label="Reachable"
        value={reachable}
        sub={`${Math.round((reachable / Math.max(insights.total, 1)) * 100)}%`}
        accent="blue"
      />
      <Stat
        label="C-Level"
        value={cLevel}
        sub={cLevel > 0 ? `${Math.round((cLevel / insights.total) * 100)}%` : undefined}
        clickable
        onClick={onFilterCLevel}
        accent="amber"
      />
      <Stat label="New this week" value={newThisWeek} accent="white" />
    </div>
  );
}
