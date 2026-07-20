import type { NewsResult } from "@/lib/news/types";
import { fetchTavily } from "@/lib/news/tavily";
import { fetchSerper } from "@/lib/news/serper";
import { fetchGnews } from "@/lib/news/gnews";

/** Fan out to all three providers in parallel and merge. Each provider degrades to []
 *  independently, so a missing key or a single provider outage never fails the batch. */
export async function fetchCompanyNews(companyName: string): Promise<NewsResult[]> {
  const query = `${companyName} (funding OR raises OR launches OR "new office" OR hiring OR award OR appoints)`;
  const [a, b, c] = await Promise.all([
    fetchTavily(query),
    fetchSerper(query),
    fetchGnews(companyName),
  ]);
  return [...a, ...b, ...c];
}
