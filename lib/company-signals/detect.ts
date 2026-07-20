/**
 * Company-signal detection core (source-agnostic, callable by the Inngest detect function).
 * Fetch merged live news → LLM extract → upsert CompanySignal (dedup on companyId+dedupeKey)
 * → advance Company.lastSignalCheckAt. Returns ids of newly-created VERIFIED signals so the
 * caller can fan out drafting. extractCompanySignals THROWS on LLM failure so the Inngest step
 * retries — never guess.
 */
import { prisma } from "@/lib/prisma";
import { fetchCompanyNews } from "@/lib/news/fetch-company-news";
import {
  extractCompanySignals,
  computeVerified,
  makeDedupeKey,
} from "@/lib/company-signals/extract";
import { Prisma } from "@/lib/generated/prisma/client";

export async function detectAndRecordSignals(
  companyId: string
): Promise<{ detected: number; verifiedNewIds: string[] }> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { id: true, name: true, website: true },
  });

  const news = await fetchCompanyNews(company.name);
  const events = news.length > 0 ? await extractCompanySignals(company.name, news) : [];

  // computeVerified resolves the official-source match via `new URL(website).hostname`
  // (hostOf in extract.ts), which returns null for a bare domain like "acme.com" with no
  // scheme — silently disabling the official-source verification path. Normalize once here
  // rather than touching the already-committed extract.ts.
  const normalizedWebsite = company.website
    ? (/^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`)
    : null;

  const verifiedNewIds: string[] = [];
  let detected = 0;

  for (const e of events) {
    const dedupeKey = makeDedupeKey(e.signalType, e.title);
    const existing = await prisma.companySignal.findUnique({
      where: { companyId_dedupeKey: { companyId: company.id, dedupeKey } },
      select: { id: true },
    });
    if (existing) continue;

    const { verified, confidence } = computeVerified(e.sources, normalizedWebsite);
    const created = await prisma.companySignal.create({
      data: {
        companyId: company.id,
        signalType: e.signalType,
        title: e.title,
        summary: e.summary,
        eventDate: e.eventDate ? new Date(e.eventDate) : null,
        confidence,
        sources: e.sources as unknown as Prisma.InputJsonValue,
        verified,
        dedupeKey,
        status: verified ? "VERIFIED" : "DETECTED",
      },
      select: { id: true, verified: true },
    });
    detected += 1;
    if (created.verified) verifiedNewIds.push(created.id);
  }

  await prisma.company.update({
    where: { id: company.id },
    data: { lastSignalCheckAt: new Date() },
  });

  return { detected, verifiedNewIds };
}
