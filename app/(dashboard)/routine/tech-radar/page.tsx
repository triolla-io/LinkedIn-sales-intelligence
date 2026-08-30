import { Radar } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TechRadarClient, TechRadarModuleSwitch } from "./tech-radar-client";

/**
 * Server page for the Tech Radar. Session auth is already enforced one level up by
 * app/(dashboard)/layout.tsx. The org-level `techRadarEnabled` flag is deliberately NOT
 * gated via redirect — mirroring fintech-radar / company-signals / job-changes, it is
 * surfaced client-side as an inline on/off switch so the user can manage the tracked
 * company list and review the queue from the same screen while the module is off.
 */
export default function TechRadarPage() {
  return (
    <div className="flex flex-col h-full min-h-screen bg-[var(--background)]">
      <PageHeader
        icon={Radar}
        title="ראדאר טכנולוגי"
        subtitle="חברות במעקב, וטכנולוגיות חדשות שמתאימות לתחום הפעילות שלהן"
        actions={<TechRadarModuleSwitch />}
      />
      <TechRadarClient />
    </div>
  );
}
