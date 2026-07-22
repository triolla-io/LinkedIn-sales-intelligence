import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { fetchTopicNews } from "@/lib/fintech-radar/fetch-topic-news";
import { extractArticles } from "@/lib/fintech-radar/extract";
import { upsertArticles, findDispatchableArticleIds } from "@/lib/fintech-radar/persist";

// Failure window we need to cover is an Inngest retry of a partially-completed upsert
// (minutes to a few hours); the tick runs daily. 12h safely spans a retry without
// reaching back into the prior day's already-dispatched articles.
const WINDOW_MS = 12 * 60 * 60 * 1000;

export const fintechRadarTick = inngest.createFunction(
  { id: "fintech-radar-tick", name: "Fintech Radar (daily)", triggers: [{ cron: "0 5 * * *" }] },
  async ({ step }) => {
    await step.run("fetch-extract-upsert", async () => {
      const news = await fetchTopicNews();
      if (news.length === 0) return [] as string[];
      const articles = await extractArticles(news);
      if (articles.length === 0) return [] as string[];
      return upsertArticles(articles);
    });

    // Fan-out source is durable state (not the upsert step's return value) so that a
    // retry of this step — or a retry of the upsert step above — never drops articles
    // that were already created but not yet dispatched to matching.
    const dispatchableArticleIds = await step.run("find-dispatchable-articles", async () =>
      findDispatchableArticleIds(Date.now() - WINDOW_MS)
    );

    if (dispatchableArticleIds.length === 0) return { dispatchable: 0, dispatched: 0 };

    const orgs = await step.run("enabled-orgs", async () =>
      prisma.organization.findMany({ where: { fintechRadarEnabled: true }, select: { id: true } })
    );
    if (orgs.length === 0) return { dispatchable: dispatchableArticleIds.length, dispatched: 0 };

    const events = orgs.flatMap((o) =>
      dispatchableArticleIds.map((articleId) => ({
        name: "fintech.radar.match" as const,
        data: { orgId: o.id, articleId },
      }))
    );
    await step.sendEvent("dispatch-match", events);
    return { dispatchable: dispatchableArticleIds.length, dispatched: events.length };
  }
);
