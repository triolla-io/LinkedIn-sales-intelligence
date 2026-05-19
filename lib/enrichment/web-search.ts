/**
 * Free company enrichment via DuckDuckGo Instant Answers API.
 * No API key required. Returns employee count + industry for most companies.
 */

export type WebEnrichResult = {
  staffCount: number | null;
  industry: string | null;
  website: string | null;
  description: string | null;
};

const EMPLOYEE_PATTERNS = [
  /(?:approximately\s+)?(\d[\d,]+)\s+(?:full[- ]time\s+)?employees/i,
  /(?:employs|workforce of|staff of)\s+(?:approximately\s+)?(\d[\d,]+)/i,
  /(\d[\d,]+)\+?\s+(?:people|workers|professionals)/i,
];

const INDUSTRY_KEYWORDS: Record<string, string> = {
  software: "Software Development",
  technology: "Technology",
  "information technology": "IT Services and IT Consulting",
  cybersecurity: "Computer and Network Security",
  fintech: "Financial Services",
  finance: "Financial Services",
  banking: "Banking",
  healthcare: "Hospitals and Health Care",
  pharmaceutical: "Pharmaceutical Manufacturing",
  automotive: "Motor Vehicle Manufacturing",
  semiconductor: "Semiconductors",
  "artificial intelligence": "Technology",
  "machine learning": "Technology",
  consulting: "Business Consulting and Services",
  staffing: "Staffing and Recruiting",
  recruiting: "Staffing and Recruiting",
  marketing: "Advertising Services",
  advertising: "Advertising Services",
  retail: "Retail",
  ecommerce: "Retail",
  logistics: "Transportation, Logistics, Supply Chain and Storage",
  manufacturing: "Manufacturing",
  education: "Education Administration Programs",
  media: "Media Production",
  telecommunications: "Telecommunications",
  "real estate": "Real Estate",
  insurance: "Insurance",
  gaming: "Computer Games",
};

function parseEmployeeCount(text: string): number | null {
  for (const pattern of EMPLOYEE_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

function parseIndustry(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [kw, label] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (lower.includes(kw)) return label;
  }
  return null;
}

export async function enrichCompanyFromWeb(name: string): Promise<WebEnrichResult> {
  const result: WebEnrichResult = { staffCount: null, industry: null, website: null, description: null };

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(name + " company")}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return result;

    const data = await res.json() as {
      AbstractText?: string;
      AbstractURL?: string;
      Infobox?: {
        content?: Array<{ label: string; value: string; data_type?: string }>;
      };
    };

    // Try Infobox structured data first (most reliable)
    if (data.Infobox?.content) {
      for (const item of data.Infobox.content) {
        const label = item.label?.toLowerCase() ?? "";
        const value = item.value ?? "";

        if (label.includes("employee") || label.includes("staff") || label.includes("workforce")) {
          const count = parseEmployeeCount(value) ?? parseEmployeeCount(value.replace(/[^0-9,]/g, "") + " employees");
          if (count) result.staffCount = count;
        }

        // "industry" label only — skip "type" which returns "Public company" / "Subsidiary" etc.
        if (label === "industry" || label === "sector") {
          const parsed = parseIndustry(value);
          if (parsed) result.industry = result.industry ?? parsed;
        }

        if (label === "website" || label === "homepage") {
          result.website = result.website ?? (value.startsWith("http") ? value : `https://${value}`);
        }
      }
    }

    // Fall back to abstract text
    if (data.AbstractText) {
      result.description = data.AbstractText.slice(0, 500) || null;
      if (!result.staffCount) result.staffCount = parseEmployeeCount(data.AbstractText);
      if (!result.industry) result.industry = parseIndustry(data.AbstractText);
      if (!result.website && data.AbstractURL) result.website = data.AbstractURL;
    }
  } catch {
    // Network error or timeout — return empty result
  }

  return result;
}
