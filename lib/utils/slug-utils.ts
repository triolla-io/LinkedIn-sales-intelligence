export function slugifyCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")  // strip punctuation except hyphens
    .replace(/\s+/g, " ")            // collapse whitespace
    .trim()
    .replace(/\s/g, "-")             // spaces → hyphens
    .replace(/-+/g, "-")             // collapse consecutive hyphens
    .replace(/^-|-$/g, "");          // strip leading/trailing hyphens
}
