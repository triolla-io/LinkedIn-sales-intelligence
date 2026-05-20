const INDUSTRY_GROUPS: Array<[string, string[]]> = [
  ["Fintech",       ["fintech", "finance", "financial", "bank", "payment", "insurance", "invest", "capital", "fund"]],
  ["SaaS",          ["saas", "software", "cloud", "platform", "tech", "technology", "ai", "data", "cyber", "security"]],
  ["Healthcare",    ["health", "medical", "pharma", "biotech", "clinic", "hospital"]],
  ["E-commerce",    ["ecommerce", "e-commerce", "retail", "shop", "marketplace"]],
  ["Real Estate",   ["real estate", "property", "realty", "construction"]],
  ["Media",         ["media", "content", "marketing", "advertising", "agency"]],
  ["Education",     ["education", "edtech", "learning", "school", "academy"]],
  ["Manufacturing", ["manufacturing", "industrial", "factory", "logistics"]],
];

export function getIndustry(companyName: string): string {
  if (!companyName) return "";
  const lower = companyName.toLowerCase();
  for (const [industry, keywords] of INDUSTRY_GROUPS) {
    if (keywords.some((kw) => lower.includes(kw))) return industry;
  }
  return "";
}
