// Order matters: first matching group wins. Existing 8 buckets keep their
// original order/position so previously-classified contacts stay stable; the
// newer verticals are appended, and anything with a company name but no keyword
// match falls through to "Other".
const INDUSTRY_GROUPS: Array<[string, string[]]> = [
  ["Fintech",       ["fintech", "finance", "financial", "bank", "payment", "insurance", "invest", "capital", "fund"]],
  ["SaaS",          ["saas", "software", "cloud", "platform", "tech", "technology", "ai", "data", "cyber", "security"]],
  ["Healthcare",    ["health", "medical", "pharma", "biotech", "clinic", "hospital", "wellness", "dental", "therapy"]],
  ["E-commerce",    ["ecommerce", "e-commerce", "retail", "shop", "marketplace", "store", "commerce"]],
  ["Real Estate",   ["real estate", "property", "realty", "construction", "builders", "housing", "mortgage"]],
  ["Media",         ["media", "content", "marketing", "advertising", "agency", "studio", "publishing", "broadcast"]],
  ["Education",     ["education", "edtech", "learning", "school", "academy", "university", "training", "tutoring"]],
  ["Manufacturing", ["manufacturing", "industrial", "factory", "machinery", "fabrication", "plastics", "steel"]],
  ["Legal",         ["law", "legal", "attorney", "advocate", "notary", "litigation", "counsel"]],
  ["Consulting",    ["consulting", "consultancy", "advisory", "professional services", "strategy"]],
  ["Government & Nonprofit", ["government", "nonprofit", "non-profit", "ngo", "municipal", "public sector", "foundation", "charity"]],
  ["HR & Staffing", ["recruit", "staffing", "talent", "human resources", "payroll", "headhunt"]],
  ["Energy",        ["energy", "solar", "renewable", "petroleum", "utilities", "electric", "cleantech", "greentech"]],
  ["Automotive",    ["automotive", "automobile", "vehicle", "mobility", "motors", "ev "]],
  ["Telecom",       ["telecom", "telecommunication", "broadband", "wireless", "cellular", "satellite"]],
  ["Travel & Hospitality", ["travel", "tourism", "hotel", "hospitality", "airline", "aviation", "resort", "vacation"]],
  ["Food & Beverage", ["food", "beverage", "restaurant", "catering", "culinary", "brewery", "winery", "coffee"]],
  ["Agriculture",   ["agriculture", "agritech", "agtech", "farming", "agronomy", "crop", "livestock"]],
  ["Logistics",     ["logistics", "shipping", "freight", "supply chain", "warehouse", "courier", "fleet", "trucking"]],
  ["Gaming",        ["gaming", "esports", "casino", "gambling", "betting", "igaming"]],
];

export function getIndustry(companyName: string): string {
  if (!companyName) return "";
  const lower = companyName.toLowerCase();
  for (const [industry, keywords] of INDUSTRY_GROUPS) {
    if (keywords.some((kw) => lower.includes(kw))) return industry;
  }
  return "Other";
}
