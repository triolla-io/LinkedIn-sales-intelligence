import { inngest } from "@/inngest/client";
import { researchTrackedCompany } from "@/lib/tech-radar/research-company";

// Research one tracked company into a profile. Fired when a company is added to the
// list, when the user asks to re-research it, and by the quarterly refresh.
// researchTrackedCompany records RESEARCH_FAILED itself rather than throwing, so a
// company with an unreadable website does not burn Inngest retries — the UI shows the
// reason and offers a retry button.
export const techRadarResearch = inngest.createFunction
(
  { id: "tech-radar-research", name: "Tech Radar — research company", concurrency: 3, triggers: [{ event: "tech-radar.company.research" as const }] },
  async ({ event, step }) => {
    const { trackedCompanyId } = event.data as { trackedCompanyId: string };
    const outcome = await step.run("research", () => researchTrackedCompany(trackedCompanyId));
    return { trackedCompanyId, ...outcome };
  }
);
