import { prisma } from "@/lib/prisma";

export type AudienceSpec =
  | { contactIds: string[] }
  | { filter: { companySizeMin?: number; companySizeMax?: number; seniority?: string[]; function?: string[]; titleContains?: string } };

export async function resolveAudience(userId: string, spec: AudienceSpec): Promise<string[]> {
  if ("contactIds" in spec) {
    const rows = await prisma.contact.findMany({
      where: { ownerId: userId, id: { in: spec.contactIds }, removedAt: null },
      select: { id: true },
    });
    return rows.map((r: { id: string }) => r.id);
  }
  const f = spec.filter;
  const companySizeFilter: { gte?: number; lte?: number } = {};
  if (f.companySizeMin !== undefined) companySizeFilter.gte = f.companySizeMin;
  if (f.companySizeMax !== undefined) companySizeFilter.lte = f.companySizeMax;

  const rows = await prisma.contact.findMany({
    where: {
      ownerId: userId,
      removedAt: null,
      ...(Object.keys(companySizeFilter).length > 0 ? { companySize: companySizeFilter } : {}),
      ...(f.seniority ? { seniority: { in: f.seniority as never } } : {}),
      ...(f.function  ? { function:  { in: f.function  as never } } : {}),
      ...(f.titleContains ? { currentTitle: { contains: f.titleContains, mode: "insensitive" } } : {}),
    },
    select: { id: true },
  });
  return rows.map((r: { id: string }) => r.id);
}
