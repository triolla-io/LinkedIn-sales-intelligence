import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { fetchTopicNews } from "@/lib/fintech-radar/fetch-topic-news";
import { extractArticles } from "@/lib/fintech-radar/extract";
import { upsertArticles } from "@/lib/fintech-radar/persist";

export const fintechRadarTick = inngest.createFunction(
  { id: "fintech-radar-tick", name: "Fintech Radar (daily)", triggers: [{ cron: "0 5 * * *" }] },
  async ({ step }) => {
    const newArticleIds = await step.run("fetch-extract-upsert", async () => {
      const news = await fetchTopicNews();
      if (news.length === 0) return [] as string[];
      const articles = await extractArticles(news);
      if (articles.length === 0) return [] as string[];
      return upsertArticles(articles);
    });

    if (newArticleIds.length === 0) return { newArticles: 0, dispatched: 0 };

    const orgs = await step.run("enabled-orgs", async () =>
      prisma.organization.findMany({ where: { fintechRadarEnabled: true }, select: { id: true } })
    );
    if (orgs.length === 0) return { newArticles: newArticleIds.length, dispatched: 0 };

    const events = orgs.flatMap((o) =>
      newArticleIds.map((articleId) => ({ name: "fintech.radar.match" as const, data: { orgId: o.id, articleId } }))
    );
    await step.sendEvent("dispatch-match", events);
    return { newArticles: newArticleIds.length, dispatched: events.length };
  }
);
