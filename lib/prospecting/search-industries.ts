import { LINKEDIN_INDUSTRIES, type LinkedInIndustry } from "./industries";

/**
 * Substring search over the LinkedIn industry taxonomy for the run form's
 * typeahead. Label-prefix matches rank first (matches how LinkedIn's own
 * facet suggest behaves), then label/path substring matches.
 */
export function searchIndustries(query: string, limit = 8): LinkedInIndustry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const prefix: LinkedInIndustry[] = [];
  const contains: LinkedInIndustry[] = [];
  for (const industry of LINKEDIN_INDUSTRIES) {
    const label = industry.label.toLowerCase();
    if (label.startsWith(q)) prefix.push(industry);
    else if (label.includes(q) || industry.path.toLowerCase().includes(q)) contains.push(industry);
  }
  return [...prefix, ...contains].slice(0, limit);
}
