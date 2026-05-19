import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (req, ctx) => {
    const t = await prisma.messageTemplate.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(t);
  })(req);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (req, ctx) => {
    const existing = await prisma.messageTemplate.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = updateSchema.parse(await req.json());
    const updated = await prisma.messageTemplate.update({ where: { id }, data: body });
    return NextResponse.json(updated);
  })(req);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (req, ctx) => {
    const existing = await prisma.messageTemplate.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.messageTemplate.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  })(req);
}
