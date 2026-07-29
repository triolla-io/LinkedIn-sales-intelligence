import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { buildSearchUrl, GEO_URNS, DEFAULT_GEO } from "@/lib/prospecting/search-url";
import { INDUSTRY_BY_ID } from "@/lib/prospecting/industries";
import { sendWindowFields, sendWindowRefine, normalizeSendDays } from "@/lib/prospecting/send-window";
import {
  CompanyInputSchema,
  companyInputToParsed,
  type ParsedCompany,
} from "@/lib/prospecting/company-sheet";
import { insertCompanyTargets } from "@/lib/prospecting/company-targets";
import { startOfDayInZone } from "@/lib/extension/task-scheduler";
import { clampRunCaps } from "@/lib/prospecting/gentle-policy";

const CreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    keywords: z.string().trim().min(1).max(500),
    targetType: z.enum(["KEYWORDS", "COMPANY"]).optional(),
    companies: z.array(CompanyInputSchema).max(500).optional(),
    geoCode: z.string().optional(),
    industryIds: z
      .array(z.string())
      .max(20)
      .refine((ids) => ids.every((id) => INDUSTRY_BY_ID.has(id)), {
        message: "unknown_industry_id",
        path: ["industryIds"],
      })
      .optional(),
    dailyCap: z.number().int().min(1).max(50).optional(),
    weeklyCap: z.number().int().min(1).max(200).optional(),
    ...sendWindowFields,
  })
  .refine(sendWindowRefine, { message: "invalid_send_window", path: ["sendHoursEnd"] });

export async function POST(req: NextRequest) {
  return withTenant(async (r: NextRequest, ctx) => {
    const body = await r.json().catch(() => null);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }
    const {
      name,
      keywords,
      geoCode,
      industryIds,
      sendDays,
      sendHoursStart,
      sendHoursEnd,
      sendMinutesStart,
      sendMinutesEnd,
      companies,
    } = parsed.data;
    const targetType = parsed.data.targetType ?? "KEYWORDS";
    // Platform hard caps: whatever the client asked for is clamped, never rejected.
    const { dailyCap, weeklyCap } = clampRunCaps({
      dailyCap: parsed.data.dailyCap,
      weeklyCap: parsed.data.weeklyCap,
    });
    // COMPANY runs default to worldwide ("" = omit geo facet); "WORLD" is the explicit sentinel.
    const geoUrn =
      targetType === "COMPANY"
        ? (geoCode && geoCode !== "WORLD" && GEO_URNS[geoCode]?.urn) || ""
        : ((geoCode && GEO_URNS[geoCode]?.urn) ?? GEO_URNS[DEFAULT_GEO].urn);
    const run = await prisma.prospectingRun.create({
      data: {
        ownerId: ctx.effectiveUserId,
        name,
        keywords,
        targetType,
        geoUrn,
        industryIds: industryIds ?? [],
        // searchUrl is per-company for COMPANY runs (built at discovery time) — store "" and never read it.
        searchUrl:
          targetType === "COMPANY"
            ? ""
            : buildSearchUrl({ keywords, geoUrn, industryIds }, 1),
        ...(dailyCap !== undefined ? { dailyCap } : {}),
        ...(weeklyCap !== undefined ? { weeklyCap } : {}),
        ...(sendDays !== undefined ? { sendDays: normalizeSendDays(sendDays) } : {}),
        ...(sendHoursStart !== undefined ? { sendHoursStart } : {}),
        ...(sendHoursEnd !== undefined ? { sendHoursEnd } : {}),
        ...(sendMinutesStart !== undefined ? { sendMinutesStart } : {}),
        ...(sendMinutesEnd !== undefined ? { sendMinutesEnd } : {}),
      },
    });
    if (targetType === "COMPANY") {
      let skippedInvalid = 0;
      const parsedCompanies: ParsedCompany[] = [];
      for (const c of companies ?? []) {
        const p = companyInputToParsed(c);
        if (p) parsedCompanies.push(p);
        else skippedInvalid++;
      }
      const result = await insertCompanyTargets(
        run.id,
        parsedCompanies,
        skippedInvalid,
      );
      return NextResponse.json({ run, companies: result }, { status: 201 });
    }
    return NextResponse.json({ run }, { status: 201 });
  })(req);
}

export async function GET(req: NextRequest) {
  return withTenant(async (_r: NextRequest, ctx) => {
    const owner = await prisma.user.findUnique({
      where: { id: ctx.effectiveUserId },
      select: { timezone: true },
    });
    // "Today" = the local calendar day (owner timezone), matching the "נשלחו היום" label.
    const dayStart = startOfDayInZone(new Date(), owner?.timezone ?? "Asia/Jerusalem");
    const [runs, sentToday] = await Promise.all([
      prisma.prospectingRun.findMany({
        where: { ownerId: ctx.effectiveUserId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.connectionRequest.count({
        where: { ownerId: ctx.effectiveUserId, status: "SENT", sentAt: { gte: dayStart } },
      }),
    ]);
    return NextResponse.json({ runs, sentToday });
  })(req);
}
