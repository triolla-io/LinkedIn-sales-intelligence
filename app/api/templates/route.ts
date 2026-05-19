import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({ name: z.string().min(1), body: z.string().min(1) });

export async function GET(req: NextRequest) {
  return withTenant(async (req, ctx) => {
    const templates = await prisma.messageTemplate.findMany({
      where: { ownerId: ctx.effectiveUserId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(templates);
  })(req);
}

export async function POST(req: NextRequest) {
  return withTenant(async (req, ctx) => {
    const body = createSchema.parse(await req.json());
    const template = await prisma.messageTemplate.create({
      data: { ownerId: ctx.effectiveUserId, ...body },
    });
    return NextResponse.json(template);
  })(req);
}
