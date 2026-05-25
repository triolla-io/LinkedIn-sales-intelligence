"use client";

import InsightTile from "./insight-tile";

type InsightsData = {
  total: number;
  bySeniority: Record<string, number>;
  byFunction: Record<string, number>;
  topCompanies: { name: string; count: number }[];
  companySizeHistogram: { bucket: string; count: number }[];
  coverage: { email: number; phone: number };
};

type FilterDelta = { seniority?: string[]; function?: string[] };

interface InsightTilesProps {
  insights: InsightsData;
  onApplyFilter: (delta: FilterDelta) => void;
}

export default function InsightTiles({ insights, onApplyFilter }: InsightTilesProps) {
  const topSeniorities = Object.entries(insights.bySeniority)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const topFunctions = Object.entries(insights.byFunction)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <InsightTile title="סה״כ אנשי קשר" value={insights.total.toLocaleString()} />
        <InsightTile title="כיסוי אימייל" value={`${insights.coverage.email}%`} />
        <InsightTile title="כיסוי טלפון" value={`${insights.coverage.phone}%`} />
      </div>

      {/* Seniority + Function breakdowns */}
      {(topSeniorities.length > 0 || topFunctions.length > 0) && (
        <div className="grid grid-cols-6 gap-3">
          {topSeniorities.map(([key, count]) => (
            <InsightTile
              key={`seniority-${key}`}
              title={key.replace(/_/g, " ")}
              value={count.toLocaleString()}
              clickable
              onClick={() => onApplyFilter({ seniority: [key] })}
            />
          ))}
          {topFunctions.map(([key, count]) => (
            <InsightTile
              key={`function-${key}`}
              title={key.replace(/_/g, " ")}
              value={count.toLocaleString()}
              clickable
              onClick={() => onApplyFilter({ function: [key] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
