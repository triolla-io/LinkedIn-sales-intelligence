import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (sequence.status !== "DRAFT") {
      return NextResponse.json({ error: "only DRAFT sequences can be started" }, { status: 409 });
    }

    await prisma.sequence.update({ where: { id }, data: { status: "QUEUED" } });
    await inngest.send({ name: "sequence.start" as const, data: { sequenceId: id } });

    return NextResponse.json({ ok: true });
  })(req);
}
