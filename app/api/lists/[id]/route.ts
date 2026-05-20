import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (req: NextRequest, ctx) => {
  // withTenant discards route params; extract ID from URL pathname
  const id = req.nextUrl.pathname.split("/").at(-1)!;

  const list = await prisma.contactList.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    include: { _count: { select: { members: true } } },
  });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? 20)));

  const members = await prisma.contactListMember.findMany({
    where: { listId: id },
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { addedAt: "desc" },
    include: {
      contact: {
        select: {
          id: true,
          fullName: true,
          headline: true,
          currentTitle: true,
          currentCompany: true,
          companySize: true,
          seniority: true,
          function: true,
          location: true,
          industry: true,
          email: true,
          phone: true,
          lastSyncedAt: true,
          linkedinUrl: true,
          company: { select: { staffCount: true, industry: true } },
        },
      },
    },
  });

  return NextResponse.json({
    list: { id: list.id, name: list.name, memberCount: list._count.members, createdAt: list.createdAt },
    contacts: members.map((m: { contact: unknown }) => m.contact),
    page,
    pageSize,
    total: list._count.members,
  });
});

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : null;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const existing = await prisma.contactList.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.contactList.update({ where: { id }, data: { name } });
  return NextResponse.json({ list: updated });
});

export const DELETE = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const existing = await prisma.contactList.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.contactList.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
