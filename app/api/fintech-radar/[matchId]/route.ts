import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

type Body =
  | { action: "dismiss" }
  | { action: "sent"; channel: "email" | "linkedin" | "whatsapp" }
  | { action: "save"; message: string };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  // withTenant discards route params; extract matchId from URL pathname
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  const match = await prisma.articleMatch.findFirst({ where: { id, ownerId: ctx.effectiveUserId }, select: { id: true } });
  if (!match) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "dismiss") {
    await prisma.articleMatch.update({ where: { id: match.id }, data: { status: "DISMISSED" } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "save") {
    const message = (body.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    await prisma.articleMatch.update({ where: { id: match.id }, data: { draftMessage: message } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "sent") {
    if (!["email", "linkedin", "whatsapp"].includes(body.channel)) {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }
    await prisma.articleMatch.update({ where: { id: match.id }, data: { status: "SENT", sentChannel: body.channel } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});
