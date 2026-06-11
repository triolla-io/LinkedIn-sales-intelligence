import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, _count: { select: { contacts: true } } },
  });

  for (const user of users) {
    await inngest.send({
      name: "contacts.enrich-hebrew-names" as const,
      data: { ownerId: user.id },
    });
  }

  return NextResponse.json({
    ok: true,
    triggered: users.map((u) => ({ email: u.email, contacts: u._count.contacts })),
  });
}
