import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { renderTemplate } from "@/lib/campaigns/render-template";
import { scheduleJitteredSend } from "@/lib/extension/schedule-send";

// Send all pending executions "now" — bypasses the per-step scheduled time, but
// still applies humanized inter-message spacing (STA-18) so a batch of approvals
// doesn't dispatch as one detectable burst. Each task stacks on the prior one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      include: { steps: { include: { template: true } } },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });

    const pending = await prisma.sequenceStepExecution.findMany({
      where: { status: "PENDING", enrollment: { sequenceId: id } },
      include: { enrollment: { include: { contact: true } }, step: { include: { template: true } } },
    });

    let created = 0;
    for (const ex of pending) {
      const contact = ex.enrollment.contact;
      if (!contact.linkedinUrl) continue;

      const rendered = renderTemplate(ex.step.template.body, {
        recipient: {
          firstName: contact.fullName?.split(" ")[0] ?? "",
          hebrewFirstName: contact.hebrewFirstName ?? contact.fullName?.split(" ")[0] ?? "",
          lastName: contact.fullName?.split(" ").slice(1).join(" ") ?? "",
          company: contact.currentCompany ?? "",
          title: contact.currentTitle ?? "",
        },
        sender: { firstName: null, lastName: null, company: null, title: null },
      });

      const { scheduledFor } = await scheduleJitteredSend(ctx.effectiveUserId);
      await prisma.extensionTask.create({
        data: {
          userId: ctx.effectiveUserId,
          kind: "SEND",
          payload: { linkedinUrl: contact.linkedinUrl, text: rendered.body, recipientName: contact.fullName ?? "" },
          sequenceExecutionId: ex.id,
          scheduledFor,
        },
      });
      await prisma.sequenceStepExecution.update({ where: { id: ex.id }, data: { status: "SENDING" } });
      created++;
    }

    return NextResponse.json({ ok: true, created });
  })(req);
}
