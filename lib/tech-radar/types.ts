/**
 * Shared type contract for the Tech Radar pipeline.
 *
 * Every module in lib/tech-radar/ codes against these types; nothing here may
 * import `@/lib/prisma` (or anything that transitively does) so the file stays
 * safe to import from client components — see lib/tech-radar/channels.ts for
 * why (pg -> dns/fs/net breaks `next build`).
 *
 * Design: docs/superpowers/specs/2026-08-18-tech-radar-design.md
 */

// ─── Company profile (research output, stored on TrackedCompany.profile) ─────

export type BusinessLine = { name: string; description: string };
export type FocusArea = { area: string; why: string };
export type ProfileSource = { url: string; title: string };

export type TechRadarProfile = {
  businessLines: BusinessLine[];
  products: string[];
  customerSegments: string[];
  techStack: string[];
  digitalInitiatives: string[];
  /** The search anchors. A profile without these is not usable. */
  focusAreas: FocusArea[];
  /** 6-10 derived queries, stored so they are stable and inspectable. */
  searchQueries: string[];
  /** What was actually read. Few sources = weak profile; the UI shows this. */
  sources: ProfileSource[];
};

/** A profile is only usable if it can drive a scan. */
export function isUsableProfile(p: unknown): p is TechRadarProfile {
  const o = p as TechRadarProfile | null;
  return (
    !!o &&
    Array.isArray(o.focusAreas) &&
    o.focusAreas.length > 0 &&
    Array.isArray(o.searchQueries) &&
    o.searchQueries.length > 0
  );
}

// ─── Discovery pipeline ──────────────────────────────────────────────────────

/** Stage 2 output: is a pool item a genuine technology launch at all? */
export type TriageVerdict = {
  url: string;
  isLaunch: boolean;
  /** Coarse tags used to prefilter items against a company's focus areas. */
  categories: string[];
  /** Short vendor/technology guess; the write-up stage refines it. */
  technology: string | null;
  vendor: string | null;
};

/** Stage 3 output: the company-agnostic write-up of one technology. */
export type TechItemDraft = {
  vendor: string | null;
  technology: string;
  title: string;
  summary: string;
  categories: string[];
  sources: { url: string; title: string; publishedAt: string | null }[];
  publishedAt: string | null;
  /** True when no page could be read and only a snippet was available. */
  thin: boolean;
};

/** Stage 4 output: the per-company judgement. */
export type FitVerdict = {
  fits: boolean;
  /** Specific to this company's lines of business — feeds the message. */
  fitRationale: string;
  score: number;
  /** Which of the company's business lines this connects to, so one line cannot
   *  take every slot in the weekly cap. Null when the model does not attribute one. */
  businessLine: string | null;
};

/** Stage 5 input: one candidate opportunity awaiting the weekly cap. */
export type CappedCandidate = {
  trackedCompanyId: string;
  itemId: string;
  fitRationale: string;
  score: number;
  /** Business line this belongs to; drives diversity inside the per-company cap. */
  lineKey?: string | null;
};

// ─── Recipients and drafting ─────────────────────────────────────────────────

export type RecipientCandidate = {
  contactId: string;
  fullName: string;
  hebrewFirstName: string | null;
  currentTitle: string | null;
  headline: string | null;
};

export type RankedRecipient = {
  contactId: string;
  score: number;
  reason: string;
};

// ─── Pipeline ceilings (spec: step budget) ───────────────────────────────────

export const MAX_QUERIES_PER_COMPANY = 10;
export const MAX_PAGE_READS_PER_RUN = 8;
export const MAX_SYNTHESIS_PER_RUN = 8;
export const MAX_OPPORTUNITIES_PER_COMPANY = 5;
export const WEEKLY_OPPORTUNITY_CAP = 15;
export const MAX_RECIPIENTS_PER_OPPORTUNITY = 3;
/** Items judged per company after category prefiltering. */
export const FIT_CANDIDATE_CAP = 15;
/** Pool items per triage LLM call — a single call over ~100 truncates its JSON. */
export const TRIAGE_CHUNK_SIZE = 25;

/** Feature tags for openrouterChat() cost attribution. */
export const OR_FEATURE = {
  profile: "tech-radar-profile",
  triage: "tech-radar-triage",
  item: "tech-radar-item",
  fit: "tech-radar-fit",
  recipients: "tech-radar-recipients",
  suggestContact: "tech-radar-suggest-contact",
  draft: "tech-radar-draft",
} as const;
