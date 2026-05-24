export interface ContactForDisplay {
  companySize?: number | null;
  /** ISO string — when Apollo last enriched this contact */
  enrichedAt?: string | null;
  /** ISO string — when LinkedIn last synced this contact */
  lastSyncedAt: string;
  company?: { staffCount: number | null; industry: string | null } | null;
  industry?: string | null;
  currentCompany?: string | null;
}

/**
 * Newest-wins: if Apollo enriched more recently than the last LinkedIn sync,
 * prefer Apollo's companySize. Otherwise prefer the LinkedIn staffCount.
 * Returns null when neither source has data.
 */
export function displayCompanySize(c: ContactForDisplay): {
  value: number | null;
  source: "apollo" | "linkedin";
} {
  const apolloAt = c.enrichedAt ? new Date(c.enrichedAt).getTime() : 0;
  const linkedinAt = c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0;

  if (c.companySize && apolloAt >= linkedinAt) {
    return { value: c.companySize, source: "apollo" };
  }
  if (c.company?.staffCount) {
    return { value: c.company.staffCount, source: "linkedin" };
  }
  return { value: c.companySize || null, source: "apollo" };
}

/**
 * Newest-wins for industry: prefer Apollo's value when enrichedAt is newer,
 * else LinkedIn's company.industry.
 */
export function displayIndustry(c: ContactForDisplay): {
  value: string | null;
  source: "apollo" | "linkedin";
} {
  const apolloAt = c.enrichedAt ? new Date(c.enrichedAt).getTime() : 0;
  const linkedinAt = c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0;

  if (c.industry && apolloAt >= linkedinAt) {
    return { value: c.industry, source: "apollo" };
  }
  if (c.company?.industry) {
    return { value: c.company.industry, source: "linkedin" };
  }
  return { value: c.industry ?? null, source: "apollo" };
}
