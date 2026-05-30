import { NextRequest, NextResponse } from "next/server";
import { withExtensionAuth } from "@/lib/extension/with-extension-auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { Prisma } from "@/lib/generated/prisma/client";

type Body =
  | { ok: true; result?: Record<string, unknown> }
  | { ok: false; errorCode: string; errorMessage?: string };

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  return withExtensionAuth(async (req, ctx) => {
    const body = (await req.json()) as Body;

    const task = await prisma.extensionTask.findFirst({ where: { id, userId: ctx.user.id } });
    if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const updated = await prisma.extensionTask.update({
      where: { id: task.id },
      data: body.ok
        ? { status: "DONE", completedAt: new Date(), result: (body.result ?? {}) as Prisma.InputJsonValue }
        : { status: "FAILED", completedAt: new Date(), errorCode: body.errorCode, errorMessage: body.errorMessage ?? null },
    });

    await inngest.send({
      name: "extension.task.completed",
      data: { taskId: updated.id, ok: body.ok, errorCode: body.ok ? null : body.errorCode },
    });

    return NextResponse.json({ ok: true });
  })(req);
}
