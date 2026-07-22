import { inngest } from "@/inngest/client";
import { fetchTopicNews } from "@/lib/fintech-radar/fetch-topic-news";
import { extractAllArticles } from "@/lib/fintech-radar/extract";
import { upsertArticles, findDispatchableArticleIds } from "@/lib/fintech-radar/persist";

// Same retry window as the weekly tick: spans an Inngest retry of a partially-completed
// upsert without reaching back into a prior run's already-dispatched articles.
const WINDOW_MS = 12 * 60 * 60 * 1000;

// Kick-on-enable: when an org turns the "Fintech Radar" module ON, fetch the latest topic
// news, upsert new articles, and dispatch matching for THIS org immediately — so it starts
// working right away instead of waiting for the weekly cron. Mirrors fintech-radar-tick,
// but fans out to the single enabled org rather than every enabled org.
export const fintechRadarDispatchOnEnable = inngest.createFunction(
  { id: "fintech-radar-dispatch-on-enable", triggers: [{ event: "fintech.radar.enabled" as const }] },
  async ({ event, step }) => {
    const { orgId } = event.data as { orgId: string };

    await step.run("fetch-extract-upsert", async () => {
      const news = await fetchTopicNews();
      if (news.length === 0) return [] as string[];
      // Chunked extraction: a single LLM call on ~100 items truncates its JSON output.
      const articles = await extractAllArticles(news);
      if (articles.length === 0) return [] as string[];
      return upsertArticles(articles);
    });

    // Fan-out source is durable state (not the upsert return value) so a retry never drops
    // articles that were created but not yet dispatched to matching.
    const dispatchableArticleIds = await step.run("find-dispatchable-articles", async () =>
      findDispatchableArticleIds(Date.now() - WINDOW_MS)
    );

    if (dispatchableArticleIds.length === 0) return { orgId, dispatched: 0 };

    await step.sendEvent(
      "dispatch-match",
      dispatchableArticleIds.map((articleId) => ({
        name: "fintech.radar.match" as const,
        data: { orgId, articleId },
      }))
    );
    return { orgId, dispatched: dispatchableArticleIds.length };
  }
);
