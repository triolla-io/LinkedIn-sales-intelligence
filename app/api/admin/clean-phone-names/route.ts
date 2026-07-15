import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cleanScrapedName } from "@/lib/prospecting/filter";
import { normalizeApolloPhone } from "@/lib/apollo/client";

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const PLUS_N = /\+\d+/;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [dirtyNameReqs, dirtyNameContacts, dirtyPhoneContacts] = await Promise.all([
    prisma.connectionRequest.findMany({
      where: { fullName: { contains: "+" } },
      select: { id: true, fullName: true },
    }),
    prisma.contact.findMany({
      where: { fullName: { contains: "+" } },
      select: { id: true, fullName: true },
    }),
    prisma.contact.findMany({
      where: { phone: { contains: "+" } },
      select: { id: true, phone: true },
    }),
  ]);

  const nameReqs = dirtyNameReqs.filter((r) => PLUS_N.test(r.fullName ?? ""));
  const nameContacts = dirtyNameContacts.filter((c) => PLUS_N.test(c.fullName));
  const phoneContacts = dirtyPhoneContacts.flatMap((c) =>
    c.phone !== null && normalizeApolloPhone(c.phone) !== c.phone
      ? [c as { id: string; phone: string }]
      : []
  );

  await Promise.all([
    ...nameReqs.map((r) =>
      prisma.connectionRequest.update({ where: { id: r.id }, data: { fullName: cleanScrapedName(r.fullName ?? "") } })
    ),
    ...nameContacts.map((c) =>
      prisma.contact.update({ where: { id: c.id }, data: { fullName: cleanScrapedName(c.fullName) } })
    ),
    ...phoneContacts.map((c) =>
      prisma.contact.update({ where: { id: c.id }, data: { phone: normalizeApolloPhone(c.phone) } })
    ),
  ]);

  return NextResponse.json({
    ok: true,
    fixed: {
      connectionRequestNames: nameReqs.length,
      contactNames: nameContacts.length,
      contactPhones: phoneContacts.length,
    },
  });
}
