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

/**
 * The homepage markup, purely to choose which inner pages to read. Never throws and
 * never fails the research: inner pages are an enrichment, and the homepage text has
 * already been captured by the time this runs.
 */
async function fetchRawHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TriollaTechRadar/1.0)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWebsite(website: string | null): string | null {
  const w = (website ?? "").trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

export type ResearchOutcome =
  | { status: "ACTIVE"; focusAreas: number; queries: number; sources: number }
  | { status: "RESEARCH_FAILED"; error: string };

/**
 * Read everything the profile call will be given: the homepage, a few inner pages, and
 * recent coverage. Extracted so a PREVIEW can research a company in memory without
 * overwriting the stored profile — a working employer profile is not something to
 * destroy in order to find out whether the new prompt is better.
 */
export async function gatherCompanySources(company: { name: string; website: string | null }): Promise<{
  website: string | null;
  pages: { url: string; title: string | null; text: string }[];
  news: { title: string; url: string; snippet: string }[];
}> {
  const website = normalizeWebsite(company.website);
  const pages: { url: string; title: string | null; text: string }[] = [];

  if (website) {
    const home = await readPage(website);
    if (home) {
      pages.push(home);
      // readPage returns clean EXTRACTED TEXT with no anchors, so inner links have to
      // come from the raw markup — reading them out of the extracted text finds
      // nothing at all (the first live run read exactly one page for this reason).
      const html = await fetchRawHtml(website);
      if (html) {
        const inner = pickInnerLinks(html, website, INNER_PAGE_LIMIT);
        pages.push(...(await readPages(inner, { limit: INNER_PAGE_LIMIT })));
      }
    }
  }

  const news = await fetchCompanyNews(company.name);
  return {
    website,
    pages,
    news: news.map((n) => ({ title: n.title, url: n.url, snippet: n.snippet })),
  };
}

export async function researchTrackedCompany(trackedCompanyId: string): Promise<ResearchOutcome> {
  const company = await prisma.trackedCompany.findUniqueOrThrow({
    where: { id: trackedCompanyId },
    select: { id: true, name: true, website: true },
  });

  try {
    const { website, pages, news } = await gatherCompanySources(company);
    const profile = await researchProfile({
      companyName: company.name,
      website,
      pages,
      news,
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
