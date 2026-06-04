import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { buildSearchUrl } from "@/lib/prospecting/search-url";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  keywords: z.string().trim().min(1).max(500),
  dailyCap: z.number().int().min(1).max(50).optional(),
  weeklyCap: z.number().int().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  return withTenant(async (r: NextRequest, ctx) => {
    const body = await r.json().catch(() => null);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }
    const { name, keywords, dailyCap, weeklyCap } = parsed.data;
    const run = await prisma.prospectingRun.create({
      data: {
        ownerId: ctx.effectiveUserId,
        name,
        keywords,
        searchUrl: buildSearchUrl(keywords, 1),
        ...(dailyCap !== undefined ? { dailyCap } : {}),
        ...(weeklyCap !== undefined ? { weeklyCap } : {}),
      },
    });
    return NextResponse.json({ run }, { status: 201 });
  })(req);
}

export async function GET(req: NextRequest) {
  return withTenant(async (_r: NextRequest, ctx) => {
    const runs = await prisma.prospectingRun.findMany({
      where: { ownerId: ctx.effectiveUserId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ runs });
  })(req);
}
