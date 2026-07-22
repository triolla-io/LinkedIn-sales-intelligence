import { prisma } from "@/lib/prisma";
import type { ExtractedArticle } from "@/lib/fintech-radar/extract";
import { normalizeUrl } from "@/lib/fintech-radar/fetch-topic-news";

/** Upsert by normalized url. Returns ids of rows CREATED this call (new articles only). */
export async function upsertArticles(articles: ExtractedArticle[]): Promise<string[]> {
  const newIds: string[] = [];
  for (const a of articles) {
    const url = normalizeUrl(a.url);
    const existing = await prisma.fintechArticle.findUnique({ where: { url }, select: { id: true } });
    if (existing) continue;
    const parsed = a.publishedAt ? new Date(a.publishedAt) : null;
    const publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    const created = await prisma.fintechArticle.create({
      data: {
        url,
        title: a.title,
        summary: a.summary,
        topics: a.topics,
        mentionedCompanies: a.mentionedCompanies,
        relevantRoles: a.relevantRoles,
        source: "fintech-radar",
        publishedAt,
      },
      select: { id: true },
    });
    newIds.push(created.id);
  }
  return newIds;
}
