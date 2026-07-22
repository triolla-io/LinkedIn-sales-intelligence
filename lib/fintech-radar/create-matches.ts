import { prisma } from "@/lib/prisma";
import { buildCandidateWhere, CANDIDATE_CAP, confirmMatches, type Candidate } from "@/lib/fintech-radar/match";

/** For one (org, article): per owner in the org, prefilter C-level candidates, confirm via LLM,
 *  create SUGGESTED ArticleMatch rows (idempotent on (articleId, contactId)).
 *  Returns match ids that still need a draft (SUGGESTED + draftMessage null). */
export async function createMatchesForOrgArticle(
  orgId: string,
  articleId: string
): Promise<{ created: number; matchIds: string[] }> {
  const article = await prisma.fintechArticle.findUniqueOrThrow({
    where: { id: articleId },
    select: { id: true, title: true, summary: true, topics: true, mentionedCompanies: true, relevantRoles: true },
  });
  const owners = await prisma.user.findMany({ where: { orgId }, select: { id: true } });

  let created = 0;
  for (const owner of owners) {
    const candidates = await prisma.contact.findMany({
      where: buildCandidateWhere(owner.id, article),
      take: CANDIDATE_CAP,
      select: { id: true, fullName: true, currentTitle: true, currentCompany: true, industry: true, headline: true },
    });
    if (candidates.length === 0) continue;

    const mapped: Candidate[] = candidates.map((c) => ({
      contactId: c.id, fullName: c.fullName, currentTitle: c.currentTitle,
      currentCompany: c.currentCompany, industry: c.industry, headline: c.headline,
    }));
    const confirmed = await confirmMatches(article, mapped);

    for (const m of confirmed) {
      const exists = await prisma.articleMatch.findUnique({
        where: { articleId_contactId: { articleId: article.id, contactId: m.contactId } },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.articleMatch.create({
        data: { articleId: article.id, contactId: m.contactId, ownerId: owner.id, score: m.score, reason: m.reason, status: "SUGGESTED" },
      });
      created += 1;
    }
  }

  // Derive draft fan-out from durable state (never in-invocation ids) — retry-safe.
  const toDraft = await prisma.articleMatch.findMany({
    where: {
      articleId: article.id,
      ownerId: { in: owners.map((o) => o.id) },
      status: "SUGGESTED",
      draftMessage: null,
    },
    select: { id: true },
  });
  return { created, matchIds: toDraft.map((m) => m.id) };
}
