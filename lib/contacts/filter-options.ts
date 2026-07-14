// Shared filter option definitions — used by the filter sidebar (labels/pills)
// and by the contacts + facets API routes (query conditions and counts).
// Keeping them in one place guarantees the facet counts match the actual filters.

export type CompanySizeBucket = {
  label: string;
  value: string;
  min: number;
  max: number | null;
};

export const COMPANY_SIZE_BUCKETS: CompanySizeBucket[] = [
  { label: "1 – 10", value: "1-10", min: 1, max: 10 },
  { label: "11 – 50", value: "11-50", min: 11, max: 50 },
  { label: "51 – 200", value: "51-200", min: 51, max: 200 },
  { label: "201 – 500", value: "201-500", min: 201, max: 500 },
  { label: "501 – 1,000", value: "501-1000", min: 501, max: 1000 },
  { label: "1,001 – 5,000", value: "1001-5000", min: 1001, max: 5000 },
  { label: "5,001+", value: "5001+", min: 5001, max: null },
];

export type PillDef = { label: string; filterKey: "titleSearch" | "function"; value: string };

export const ROLE_PILLS: PillDef[] = [
  { label: "CEO", filterKey: "titleSearch", value: "CEO" },
  { label: "COO", filterKey: "titleSearch", value: "COO" },
  { label: "CFO", filterKey: "titleSearch", value: "CFO" },
  { label: "CTO", filterKey: "titleSearch", value: "CTO" },
  { label: "Founder", filterKey: "titleSearch", value: "Founder" },
  { label: "HR", filterKey: "function", value: "HR" },
  { label: "CMO", filterKey: "titleSearch", value: "CMO" },
  { label: "CPO", filterKey: "titleSearch", value: "CPO" },
  { label: "Sales", filterKey: "function", value: "SALES" },
  { label: "PM", filterKey: "titleSearch", value: "Product Manager" },
  { label: "VP Product", filterKey: "titleSearch", value: "VP Product" },
  { label: "Head of Product", filterKey: "titleSearch", value: "Head of Product" },
  { label: "Product Director", filterKey: "titleSearch", value: "Product Director" },
  { label: "Head of Design", filterKey: "titleSearch", value: "Head of Design" },
];

export const INDUSTRY_PILLS = [
  "Cyber Security", "SaaS", "Fintech", "Healthcare", "Real Estate",
  "E-commerce", "Education", "Media", "Manufacturing",
  "Legal", "Consulting", "Government & Nonprofit", "HR & Staffing",
  "Energy", "Automotive", "Telecom", "Travel & Hospitality",
  "Food & Beverage", "Agriculture", "Logistics", "Gaming",
  "Other",
];
