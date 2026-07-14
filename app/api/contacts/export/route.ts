import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import {
  buildContactWhere,
  parseArrayParam,
  type ContactFilterParams,
} from "@/lib/contacts/contact-where";

export const dynamic = "force-dynamic";

function escapeCsv(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export const GET = withTenant(async (req, ctx) => {
  const url = req.nextUrl;

  const params: ContactFilterParams = {
    q: url.searchParams.get("q") ?? undefined,
    seniority: parseArrayParam(url.searchParams.get("seniority")),
    function: parseArrayParam(url.searchParams.get("function")),
    titleSearch: parseArrayParam(url.searchParams.get("titleSearch")),
    industry: parseArrayParam(url.searchParams.get("industry")),
    company: parseArrayParam(url.searchParams.get("company")),
    location: parseArrayParam(url.searchParams.get("location")),
    companySizeBuckets: parseArrayParam(url.searchParams.get("companySizeBuckets")),
    hasEmail: (url.searchParams.get("hasEmail") as "true" | "false") ?? undefined,
    hasPhone: (url.searchParams.get("hasPhone") as "true" | "false") ?? undefined,
    listId: url.searchParams.get("listId") ?? undefined,
  };

  const where = buildContactWhere(ctx.effectiveUserId, params);

  try {
    const rows = await prisma.contact.findMany({
      where,
      orderBy: [{ lastSyncedAt: "desc" }, { id: "desc" }],
      take: 50_000,
      select: {
        fullName: true,
        currentTitle: true,
        currentCompany: true,
        email: true,
        phone: true,
        location: true,
        industry: true,
        seniority: true,
        linkedinUrl: true,
      },
    });

    const headers = ["Name", "Title", "Company", "Email", "Phone", "Location", "Industry", "Seniority", "LinkedIn URL"];
    const lines = [
      headers.map(escapeCsv).join(","),
      ...rows.map((r) =>
        [
          r.fullName,
          r.currentTitle,
          r.currentCompany,
          r.email,
          r.phone,
          r.location,
          r.industry,
          r.seniority,
          r.linkedinUrl,
        ]
          .map(escapeCsv)
          .join(",")
      ),
    ];

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contacts-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Export failed:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
});
