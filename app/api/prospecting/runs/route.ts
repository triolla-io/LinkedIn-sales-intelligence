import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { buildSearchUrl, GEO_URNS, DEFAULT_GEO } from "@/lib/prospecting/search-url";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  keywords: z.string().trim().min(1).max(500),
  geoCode: z.string().optional(),
  dailyCap: z.number().int().min(1).max(50).optional(),
  weeklyCap: z.number().int().min(1).max(200).optional(),
  sendHoursStart: z.number().int().min(0).max(23).optional(),
  sendHoursEnd: z.number().int().min(1).max(24).optional(),
  sendDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
});

export async function POST(req: NextRequest) {
  return withTenant(async (r: NextRequest, ctx) => {
    const body = await r.json().catch(() => null);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }
    const { name, keywords, geoCode, dailyCap, weeklyCap, sendHoursStart, sendHoursEnd, sendDays } = parsed.data;
    const geoUrn = (geoCode && GEO_URNS[geoCode]?.urn) ?? GEO_URNS[DEFAULT_GEO].urn;

    // Default sendDays based on country: IL = Sun–Thu [0-4], others = Mon–Fri [1-5]
    const defaultSendDays = geoCode === "IL" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];

    const run = await prisma.prospectingRun.create({
      data: {
        ownerId: ctx.effectiveUserId,
        name,
        keywords,
        geoUrn,
        searchUrl: buildSearchUrl(keywords, 1, geoUrn),
        ...(dailyCap !== undefined ? { dailyCap } : {}),
        ...(weeklyCap !== undefined ? { weeklyCap } : {}),
        sendHoursStart: sendHoursStart ?? 9,
        sendHoursEnd: sendHoursEnd ?? 18,
        sendDays: sendDays ?? defaultSendDays,
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
