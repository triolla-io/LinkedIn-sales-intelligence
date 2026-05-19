import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { renderTemplate } from "@/lib/templates/render";
import { checkDailyLimit, checkSpacingLimit } from "@/lib/ratelimit/messages";
import { z } from "zod";
import { recordAudit } from "@/lib/admin/audit";

const schema = z
  .object({
    contactId: z.string(),
    templateId: z.string().optional(),
    body: z.string().optional(),
  })
  .refine((d) => d.templateId || d.body, { message: "templateId or body required" });

export async function POST(req: NextRequest) {
  return withTenant(async (req, ctx) => {
    const parsed = schema.parse(await req.json());

    const contact = await prisma.contact.findFirst({
      where: { id: parsed.contactId, ownerId: ctx.effectiveUserId },
    });
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

    let body = parsed.body ?? "";
    if (parsed.templateId) {
      const tmpl = await prisma.messageTemplate.findFirst({
        where: { id: parsed.templateId, ownerId: ctx.effectiveUserId },
      });
      if (!tmpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      const { rendered } = renderTemplate(tmpl.body, contact);
      body = rendered;
    }

    const dailyCheck = await checkDailyLimit(ctx.effectiveUserId);
    if (!dailyCheck.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMIT_EXCEEDED", retryAfter: dailyCheck.retryAfter, type: "daily" },
        { status: 429 }
      );
    }

    const spacingCheck = await checkSpacingLimit(ctx.effectiveUserId);
    if (!spacingCheck.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMIT_EXCEEDED", retryAfter: spacingCheck.retryAfter, type: "spacing" },
        { status: 429 }
      );
    }

    const sentMessage = await prisma.sentMessage.create({
      data: {
        senderId: ctx.effectiveUserId,
        actorId: ctx.user.id,
        contactId: contact.id,
        templateId: parsed.templateId,
        body,
        status: "QUEUED",
      },
    });

    await inngest.send({ name: "message.send", data: { messageId: sentMessage.id } });

    if (ctx.impersonatedUserId) {
      await recordAudit(ctx, "message.send", { messageId: sentMessage.id, contactId: contact.id });
    }

    return NextResponse.json({ messageId: sentMessage.id });
  })(req);
}
