/**
 * Tenure and trajectory, computed from the scraped `dateRange` strings — in CODE, never
 * guessed by the model.
 *
 * The person model has to know how long someone has been in their chair and how they got
 * there: someone who rose through branch management reads retail banking differently from
 * someone who arrived from a digital product role. Until now the build prompt was invited
 * to infer that from a job title, and a guessed tenure is indistinguishable from a real one
 * once it is downstream. The same lesson has already cost us live: the model invented
 * `dateIso: "2024-01-01"` for five axes, which silently removed them from the search pool.
 *
 * So: anything derivable arithmetically is derived here, and anything not derivable is
 * `null` — never a plausible-looking number. Pure module: no prisma, no LLM, no fetch. The
 * only clock read is `new Date().getFullYear()`, to close an open-ended "Present".
 */

/**
 * Only 19xx/20xx, anchored on word boundaries. LinkedIn appends a duration to the range
 * ("Jan 2020 - Present · 5 yrs 3 mos"), so a looser 4-digit match would happily read a
 * month count or an employee number as a year.
 */
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

/**
 * "Still there", in both UI languages. The Latin words carry \b so `current` cannot match
 * inside an unrelated word; the Hebrew ones deliberately do not, because \b is ASCII-word
 * based and asserts nothing useful next to a Hebrew letter.
 */
const PRESENT_RE = /\bpresent\b|\bcurrent(?:ly)?\b|היום|כיום|הווה|נוכחי/i;

export type ParsedDateRange = { startYear: number | null; endYear: number | null; current: boolean };

/**
 * Years only. LinkedIn's month abbreviations differ per UI language ("Jan" vs "ינו׳") and
 * month precision buys the person model nothing it would use, so we do not parse them —
 * one less locale table to be wrong about.
 *
 * A range with no extractable year returns all-nulls INCLUDING `current: false`, even if it
 * said "Present": with no start year there is nothing to measure the tenure from, so a
 * `current: true` there would be a claim we cannot quantify.
 */
export function parseDateRange(raw: string | null): ParsedDateRange {
  if (typeof raw !== "string" || !raw.trim()) return { startYear: null, endYear: null, current: false };
  const years = [...raw.matchAll(YEAR_RE)].map((m) => Number(m[0]));
  if (years.length === 0) return { startYear: null, endYear: null, current: false };
  const current = PRESENT_RE.test(raw);
  // A single year with no "Present" is a same-year stint ("2019"), not an open range.
  return { startYear: years[0], endYear: current ? null : years[1] ?? years[0], current };
}

type Exp = { title?: unknown; company?: unknown; dateRange?: unknown };

export type CareerSummary = {
  tenureYearsInCurrentRole: number | null;
  path: { title: string; company: string | null; years: number | null }[];
};

/**
 * `Contact.experience` is untyped Json (newest first, max 5) that can arrive null, as a
 * non-array, or with malformed rows — so every shape yields a summary and none throws. A
 * row without a usable title is dropped rather than kept with a placeholder: a nameless
 * step in a career path is noise the prompt would have to reason around.
 *
 * Tenure comes from the FIRST row still marked current, matching "newest first". A duration
 * that comes out negative (reversed or future-dated scrape garbage) becomes `null` — an
 * unknown tenure is honest, a negative one is visibly broken data dressed as a fact.
 */
export function careerSummary(experience: unknown): CareerSummary {
  const rows = Array.isArray(experience) ? (experience as Exp[]) : [];
  const nowYear = new Date().getFullYear();
  const path: CareerSummary["path"] = [];
  let tenure: number | null = null;

  for (const row of rows) {
    if (typeof row?.title !== "string" || !row.title.trim()) continue;
    const range = parseDateRange(typeof row.dateRange === "string" ? row.dateRange : null);

    let years: number | null = null;
    if (range.startYear != null) {
      const end = range.current ? nowYear : range.endYear ?? range.startYear;
      years = nonNegative(end - range.startYear);
    }
    if (range.current && tenure == null && range.startYear != null) {
      tenure = nonNegative(nowYear - range.startYear);
    }

    path.push({
      title: row.title,
      company: typeof row.company === "string" ? row.company : null,
      years,
    });
  }

  return { tenureYearsInCurrentRole: tenure, path };
}

/** A negative span means the dates are wrong, not that the job ran backwards. */
function nonNegative(span: number): number | null {
  return Number.isFinite(span) && span >= 0 ? span : null;
}
