import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { summarizeCohort } from "@/lib/tech-radar/population";

/**
 * The cohort summary, split out from GET /api/tech-radar so a 30-second poll never has
 * to re-scan the owner's entire contact list. `summarizeCohort` loads and joins the
 * owner's whole non-removed contact list — for the pilot owner that is 16,250 rows, and
 * the old combined route paid that cost twice a minute per open tab.
 *
 * The client fetches this route once on mount and revalidates on focus (see
 * tech-radar-client.tsx's second `useSWR` key, `refreshInterval: 0`), not on an interval.
 *
 * Deliberately NOT gated behind techRadarEnabled: reviewing the cohort is how a rep
 * decides whether to turn the module on in the first place. Gating it behind the flag
 * would hide the strip exactly when it is needed — before the flag is flipped.
 */
export const GET = withTenant(async (_req, ctx) => {
  const { counts, employers, noEmployer } = await summarizeCohort(ctx.effectiveUserId);
  return NextResponse.json({ cohort: { ...counts, employers: employers.length, noEmployer } });
});
