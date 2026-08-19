import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

type Body =
  | { action: "research" }
  | { action: "scan" }
  | { action: "aliases"; aliases: string[] }
  | { action: "interval"; scanIntervalDays: number };

/** Resolve the company inside the caller's org — never across tenants. */
async function findInOrg(userId: string, id: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { orgId: true } });
  const company = await prisma.trackedCompany.findFirst({
    where: { id, orgId: user.orgId },
    select: { id: true, status: true },
  });
  return company ? { ...company, orgId: user.orgId } : null;
}

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const company = await findInOrg(ctx.effectiveUserId, id);
  if (!company) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json()) as Body;

  if (body.action === "research") {
    await prisma.trackedCompany.update({
      where: { id: company.id },
      data: { status: "PENDING_RESEARCH", profileError: null },
    });
    await inngest.send({ name: "tech-radar.company.research" as const, data: { trackedCompanyId: company.id } });
    return NextResponse.json({ ok: true });
  }

  /**
   * Scan on demand. Without this the only ways to scan are the weekly cron (Sunday
   * 06:00) and toggling the whole module off and on, so a rep who adds a company today
   * sees nothing until next week.
   *
   * Clearing lastScanAt is what makes the interval check in loadScannableCompanies treat
   * this company as due. The scan itself is per-ORG by design (one canonical query pool
   * serves every company), so any other company that is also due gets picked up in the
   * same run — which is cheaper than scanning them separately.
   */
  if (body.action === "scan") {
    if (company.status !== "ACTIVE") {
      return NextResponse.json({ error: "not_active", status: company.status }, { status: 409 });
    }
    await prisma.trackedCompany.update({ where: { id: company.id }, data: { lastScanAt: null } });
    await inngest.send({ name: "tech-radar.scan" as const, data: { orgId: company.orgId } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "aliases") {
    if (!Array.isArray(body.aliases)) {
      return NextResponse.json({ error: "invalid_aliases" }, { status: 400 });
    }
    const seen = new Set<string>();
    const aliases: string[] = [];
    for (const entry of body.aliases) {
      if (typeof entry !== "string") continue;
      const name = entry.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      aliases.push(name);
    }
    await prisma.trackedCompany.update({ where: { id: company.id }, data: { aliases: aliases.slice(0, 10) } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "interval") {
    const days = Number(body.scanIntervalDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return NextResponse.json({ error: "invalid_interval" }, { status: 400 });
    }
    await prisma.trackedCompany.update({ where: { id: company.id }, data: { scanIntervalDays: days } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});

export const DELETE = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const company = await findInOrg(ctx.effectiveUserId, id);
  if (!company) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Opportunities and drafts cascade from the schema.
  await prisma.trackedCompany.delete({ where: { id: company.id } });
  return NextResponse.json({ ok: true });
});
