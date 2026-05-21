import type { Seniority, Function as OccFunction } from "@/lib/generated/prisma/client";

type Classification = { seniority: Seniority; function: OccFunction };

// Seniority rules — ordered most-specific first
// VP is checked before C_LEVEL so "vice president" doesn't match "president"
const SENIORITY_RULES: Array<[RegExp, Seniority]> = [
  [/\bvp\b|vice[\s-]?president/, "VP"],
  [/(chief|founder|co-founder|owner|ceo|cto|coo|cmo|cfo|ciso|cpo|cdo)\b|(?<!vice[\s-]?)\bpresident\b/, "C_LEVEL"],
  [/\b(director|head of|head,)\b/, "DIRECTOR"],
  [/\b(manager|lead|principal|staff|sr\.?|senior|partner|specialist|coordinator|associate)\b/, "MANAGER"],
];

// Function keyword sets
const FUNCTION_RULES: Array<[RegExp, OccFunction]> = [
  [/engineer|developer|swe|devops|sre|software|infra|architect|backend|frontend|fullstack|data sci|ml |machine learning|ai |platform/, "ENGINEERING"],
  [/\bsales\b|account exec|ae\b|bdr|sdr|business dev|account manager/, "SALES"],
  [/market|growth|brand|content|demand gen|seo|social|pr |communications/, "MARKETING"],
  [/product manager|product owner|\bpm\b|product lead|head of product|vp of product|director of product|product director|product head/, "PRODUCT"],
  [/\bhr\b|human res|people ops|talent|recruit|learn & dev|learning and dev/, "HR"],
  [/financ|accountin|controller|treasurer|fp&a|cfo/, "FINANCE"],
  [/operat|supply chain|logistics|procurement|biz ops/, "OPERATIONS"],
  [/legal|counsel|attorney|lawyer|compliance|regulatory/, "LEGAL"],
];

export function classify(title: string): Classification {
  const lower = title
    .toLowerCase()
    .replace(/[^\w\s&./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Seniority
  let seniority: Seniority = "IC";
  for (const [pattern, level] of SENIORITY_RULES) {
    if (pattern.test(lower)) {
      seniority = level;
      break;
    }
  }

  // Function
  let fn: OccFunction = "OTHER";
  for (const [pattern, dept] of FUNCTION_RULES) {
    if (pattern.test(lower)) {
      fn = dept;
      break;
    }
  }

  return { seniority, function: fn };
}
