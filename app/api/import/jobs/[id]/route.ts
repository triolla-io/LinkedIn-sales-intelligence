import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return withTenant(async (_req, ctx) => {
    const job = await prisma.importJob.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      select: {
        id: true,
        status: true,
        stage: true,
        total: true,
        processed: true,
        error: true,
        fileName: true,
        added: true,
        updated: true,
        removed: true,
        unchanged: true,
        companies: true,
        newCompanies: true,
      },
    });
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(job);
  })(req);
}
