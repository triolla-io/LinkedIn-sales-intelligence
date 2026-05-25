import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export async function POST() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, _count: { select: { contacts: true } } },
  });

  for (const user of users) {
    await inngest.send({
      name: "contacts.enrich-haiku" as const,
      data: { ownerId: user.id },
    });
  }

  return NextResponse.json({
    ok: true,
    triggered: users.map((u) => ({ email: u.email, contacts: u._count.contacts })),
  });
}
