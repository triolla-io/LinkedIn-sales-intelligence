import type { NewsResult } from "@/lib/news/types";
import { fetchTavily } from "@/lib/news/tavily";
import { fetchSerper } from "@/lib/news/serper";
import { fetchGnews } from "@/lib/news/gnews";
import { fetchSerpapi } from "@/lib/news/serpapi";

/** Fan out to every provider in parallel and merge. Each degrades to [] independently,
 *  so a missing key or a single provider outage never fails the batch. */
export async function fetchCompanyNews(companyName: string): Promise<NewsResult[]> {
  const query = `${companyName} (funding OR raises OR launches OR "new office" OR hiring OR award OR appoints)`;
  const [a, b, c, d] = await Promise.all([
    // Plain company name for SerpApi: the boolean form is Tavily/Serper syntax and
    // only narrows Google News coverage of the company itself.
    fetchSerpapi(companyName, { days: 90 }),
    fetchTavily(query),
    fetchSerper(query),
    fetchGnews(companyName),
  ]);
  return [...a, ...b, ...c, ...d];
}
