import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { draftEngagement } from "@/lib/fintech-radar/draft";

export const fintechRadarDraft = inngest.createFunction(
  { id: "fintech-radar-draft", name: "Fintech Radar — draft", concurrency: 5, triggers: [{ event: "fintech.radar.draft" as const }] },
  async ({ event, step }) => {
    const { matchId } = event.data as { matchId: string };
    await step.run("draft", async () => {
      const m = await prisma.articleMatch.findUnique({
        where: { id: matchId },
        select: {
          id: true, draftMessage: true,
          contact: { select: { fullName: true, hebrewFirstName: true, currentTitle: true } },
          article: { select: { title: true, summary: true, url: true } },
        },
      });
      if (!m || m.draftMessage) return; // idempotent: already drafted
      const message = await draftEngagement({
        contactFullName: m.contact.fullName,
        hebrewFirstName: m.contact.hebrewFirstName,
        contactTitle: m.contact.currentTitle,
        articleTitle: m.article.title,
        articleSummary: m.article.summary,
        articleUrl: m.article.url,
      });
      await prisma.articleMatch.update({ where: { id: m.id }, data: { draftMessage: message } });
    });
    return { ok: true };
  }
);
