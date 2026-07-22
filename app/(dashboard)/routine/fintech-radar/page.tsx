import { Newspaper } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { FintechRadarClient, RadarModuleSwitch } from "./fintech-radar-client";

/**
 * Server page for the Fintech Radar feed. Session auth (redirect to
 * /sign-in when unauthenticated) is already enforced one level up by
 * app/(dashboard)/layout.tsx, same as every other route under (dashboard) —
 * this page does not need to repeat that check. The org-level
 * `fintechRadarEnabled` flag is not gated via redirect either: mirroring
 * company-signals/job-changes, it's surfaced client-side (via
 * useRoutineModules in the client feed) as an inline on/off switch so users
 * can review the existing queue and flip the toggle from the same screen.
 */
export default function FintechRadarPage() {
  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      <PageHeader
        icon={Newspaper}
        title="ראדאר"
        subtitle="חדשות פינטק שבועיות, מותאמות לאנשי הקשר שלך"
        actions={<RadarModuleSwitch />}
      />
      <FintechRadarClient />
    </div>
  );
}
