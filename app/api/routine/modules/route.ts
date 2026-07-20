import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { getRoutineModuleState, setRoutineModule } from "@/lib/routine/modules";

export const GET = withTenant(async (_req, ctx) => {
  return NextResponse.json(await getRoutineModuleState(ctx.effectiveUserId));
});

export const PATCH = withTenant(async (req, ctx) => {
  const body = await req.json().catch(() => null);
  const module = body?.module;
  const enabled = body?.enabled;
  if (
    (module !== "connections" && module !== "jobChecks" && module !== "companySignals") ||
    typeof enabled !== "boolean"
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  await setRoutineModule(ctx.effectiveUserId, module, enabled);
  return NextResponse.json(await getRoutineModuleState(ctx.effectiveUserId));
});
