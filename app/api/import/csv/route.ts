import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { parseConnectionsFile } from "@/lib/csv/parse";

/**
 * POST /api/import/csv
 * Accepts a LinkedIn connections export (multipart/form-data, field "file").
 * Parses synchronously, enqueues a background import job, returns { jobId }.
 */
export const POST = withTenant(async (req: NextRequest, ctx) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const updateOnly = formData.get("updateOnly") === "true";

  const { contacts, error } = await parseConnectionsFile(file);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (contacts.length === 0) return NextResponse.json({ error: "No valid contacts found in CSV" }, { status: 400 });

  const userId = ctx.effectiveUserId;
  const job = await prisma.importJob.create({
    data: {
      ownerId: userId,
      fileName: file.name,
      status: "QUEUED",
      updateOnly,
      stage: "queued",
      total: contacts.length,
      payload: contacts as unknown as Prisma.InputJsonValue,
    },
  });

  await inngest.send({ name: "import.process" as const, data: { importJobId: job.id, ownerId: userId } });

  return NextResponse.json({ jobId: job.id });
});
