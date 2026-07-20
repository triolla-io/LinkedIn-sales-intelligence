import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { createToken, listTokens } from "@/lib/mcp/tokens";

const CreateSchema = z.object({ label: z.string().trim().min(1).max(80) });

function assertTriolla(email: string) {
  return email.toLowerCase().endsWith("@triolla.io");
}

export const GET = withTenant(async (_req, ctx) => {
  const tokens = await listTokens(ctx.user.id);
  return NextResponse.json({ tokens });
});

export const POST = withTenant(async (req, ctx) => {
  if (!assertTriolla(ctx.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }
  const { id, raw } = await createToken(ctx.user.id, parsed.data.label);
  return NextResponse.json({ id, token: raw });
});
