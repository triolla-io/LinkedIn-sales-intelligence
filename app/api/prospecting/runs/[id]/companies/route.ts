import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";
import {
  CompanyInputSchema,
  companyInputToParsed,
  parseCompaniesFile,
  type ParsedCompany,
} from "@/lib/prospecting/company-sheet";
import { insertCompanyTargets } from "@/lib/prospecting/company-targets";

const JsonSchema = z.object({
  companies: z.array(CompanyInputSchema).min(1).max(1000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withTenant(async (r: NextRequest, ctx) => {
    const run = await prisma.prospectingRun.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (run.targetType !== "COMPANY") {
      return NextResponse.json({ error: "not_company_run" }, { status: 409 });
    }

    let companies: ParsedCompany[] = [];
    let skippedInvalid = 0;
    const contentType = r.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const file = (await r.formData()).get("file") as File | null;
      if (!file)
        return NextResponse.json({ error: "no_file" }, { status: 400 });
      const parsed = await parseCompaniesFile(file);
      if (parsed.error)
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      companies = parsed.companies;
      skippedInvalid = parsed.skippedInvalid;
    } else {
      const body = await r.json().catch(() => null);
      const parsed = JsonSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "invalid_input", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      for (const c of parsed.data.companies) {
        const p = companyInputToParsed(c);
        if (p) companies.push(p);
        else skippedInvalid++;
      }
    }

    const result = await insertCompanyTargets(run.id, companies, skippedInvalid);

    // Re-uploading companies reactivates a finished run (spec: completion re-opens on new targets).
    if (result.added > 0 && (run.status === "COMPLETED" || run.discoveryDone)) {
      await prisma.prospectingRun.update({
        where: { id: run.id },
        data: {
          ...(run.status === "COMPLETED" ? { status: "RUNNING" } : {}),
          discoveryDone: false,
          completedAt: null,
        },
      });
      if (run.status === "COMPLETED" || run.status === "RUNNING") {
        await inngest.send({
          name: "prospecting.start" as const,
          data: { runId: run.id },
        });
      }
    }

    return NextResponse.json(result);
  })(req);
}
