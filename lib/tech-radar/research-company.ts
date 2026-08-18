/**
 * Orchestrates research for one tracked company: gather text, build the profile,
 * record the outcome.
 *
 * The status transition is the safety gate. Only ACTIVE companies are scanned, so
 * a company whose research failed can never emit random opportunities — it sits
 * in RESEARCH_FAILED with a reason on screen and a "research again" button.
 */
import { prisma } from "@/lib/prisma";
import { readPage, readPages } from "@/lib/research/read-page";
import { fetchCompanyNews } from "@/lib/news/fetch-company-news";
import { pickInnerLinks, researchProfile } from "@/lib/tech-radar/profile";

/** Inner pages read beyond the homepage. */
const INNER_PAGE_LIMIT = 5;

function normalizeWebsite(website: string | null): string | null {
  const w = (website ?? "").trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

export type ResearchOutcome =
  | { status: "ACTIVE"; focusAreas: number; queries: number; sources: number }
  | { status: "RESEARCH_FAILED"; error: string };

export async function researchTrackedCompany(trackedCompanyId: string): Promise<ResearchOutcome> {
  const company = await prisma.trackedCompany.findUniqueOrThrow({
    where: { id: trackedCompanyId },
    select: { id: true, name: true, website: true },
  });

  try {
    const website = normalizeWebsite(company.website);
    const pages: { url: string; title: string | null; text: string }[] = [];

    if (website) {
      const home = await readPage(website);
      if (home) {
        pages.push(home);
        // Inner links are chosen from the homepage markup, so re-read it raw only
        // when the extractor gave us clean text without the anchors we need.
        const inner = pickInnerLinks(home.text, website, INNER_PAGE_LIMIT);
        pages.push(...(await readPages(inner, { limit: INNER_PAGE_LIMIT })));
      }
    }

    const news = await fetchCompanyNews(company.name);
    const profile = await researchProfile({
      companyName: company.name,
      website,
      pages,
      news: news.map((n) => ({ title: n.title, url: n.url, snippet: n.snippet })),
    });

    await prisma.trackedCompany.update({
      where: { id: company.id },
      data: {
        profile,
        profileError: null,
        researchedAt: new Date(),
        status: "ACTIVE",
      },
    });

    return {
      status: "ACTIVE",
      focusAreas: profile.focusAreas.length,
      queries: profile.searchQueries.length,
      sources: profile.sources.length,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.trackedCompany.update({
      where: { id: company.id },
      data: { status: "RESEARCH_FAILED", profileError: error.slice(0, 500) },
    });
    return { status: "RESEARCH_FAILED", error };
  }
}
