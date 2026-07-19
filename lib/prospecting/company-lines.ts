/** One manual-entry line: a company name, or a LinkedIn company URL. Client-safe (no deps). */
export type CompanyLine = { name?: string; linkedinUrl?: string };

export function parseCompanyLines(text: string): CompanyLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) =>
      /linkedin\.com/i.test(line) || /^https?:\/\//i.test(line)
        ? { linkedinUrl: line }
        : { name: line },
    );
}
