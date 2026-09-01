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

/**
 * `forWhom` = who THIS line serves, not who the company serves. Added 2026-08-31:
 * a Head of Retail Banking was handed the bank's company-wide customerSegments as
 * her own customers, because the line she owns had no audience of its own to quote.
 * "" on a profile researched before this change — unknown, never a guess.
 */
export type BusinessLine = { name: string; description: string; forWhom: string };
export type FocusArea = { area: string; why: string };
export type ProfileSource = { url: string; title: string };

export type TechRadarProfile = {
  businessLines: BusinessLine[];
  products: string[];
  /** B2C/B2B/B2G and who actually pays. Required — research without it is not done. */
  customerSegments: string[];
  /** What they sell and to whom, one plain sentence. Required. */
  whatTheySell: string;
  /**
   * Competitors by NAME (Lemonade for Phoenix, Leumi⇄Hapoalim). Feeds dedicated
   * competitor-monitoring queries in the person model. May be empty ONLY when the
   * model explicitly finds there are none — see noClearCompetitors.
   */
  namedCompetitors: string[];
  /**
   * An ACTIVE finding that no direct competitor exists, with its reason — never a
   * default. An empty competitor list without this is a field the model forgot,
   * and the research fails loudly instead of completing blind. Shown on the person
   * page so a human can correct a wrong finding.
   */
  noClearCompetitors: boolean;
  noCompetitorsReason: string;
  techStack: string[];
  digitalInitiatives: string[];
  /** The search anchors. A profile without these is not usable. */
  focusAreas: FocusArea[];
  /** 6-10 derived queries, stored so they are stable and inspectable. */
  searchQueries: string[];
  /** What was actually read. Few sources = weak profile; the UI shows this. */
  sources: ProfileSource[];
  /**
   * Layer 1 of the 2026-08-26 four-layer person model: the industry this company is
   * in, as a canonical name in both scripts where both are used, plus the BROAD
   * industry-level queries every company in that industry shares. Required by
   * `missingResearchFields` on fresh research. Optional here (not on
   * `whatTheySell`'s footing) only because profiles researched before this task have
   * no `industry` at all — see the refresh-compat note in profile.ts.
   */
  industry?: { canonical: string; queries: string[] };
  /**
   * Layer 3: what is occupying this company RIGHT NOW, extracted ONLY from dated
   * news. A move without a parseable `dateIso` is dropped by the parser rather than
   * kept undated. Optional for the same legacy-profile reason as `industry`.
   */
  recentMoves?: { fact: string; dateIso: string; sourceUrl?: string }[];
  /**
   * An ACTIVE "quiet" finding — true when the news showed no verified move, so an
   * empty `recentMoves` is a finding rather than a default. Required alongside
   * `recentMoves` by `missingResearchFields`.
   */
  quietNow?: boolean;
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

/**
 * What kind of thing an item is.
 *
 * Not decoration: the drafting stage picks its archetype from `kind`, and the learning
 * loop raises a per-kind `shareworthy` floor when a kind is discarded too often. An
 * unrecognised value must therefore land on "other" rather than on any kind that
 * carries a policy.
 */
export type ItemKind =
  | "research"
  | "trend"
  | "big_news"
  | "company_move"
  | "vendor_launch"
  | "promotion"
  | "other";

export const ITEM_KINDS: readonly ItemKind[] = [
  "research",
  "trend",
  "big_news",
  "company_move",
  "vendor_launch",
  "promotion",
  "other",
] as const;

/** Below this, an item is not worth a person's attention, whatever its kind. */
export const SHAREWORTHY_FLOOR = 0.6;

/**
 * Weight, separate from relevance.
 *
 * The 2026-08-23 run returned items that were genuinely on-topic and still not worth
 * sending: a Nature paper on a CO2 injection polymer, a trade-journal piece on a pipe
 * inspection robot. Correct subject, no gift in it. `shareworthy` could not tell them
 * apart from a flagship report, because relevance and weight are different questions.
 *
 * High: a flagship report from a major consultancy or analyst house, a Big-5 survey, a
 * regulatory move, a large market move. Low: a niche-tool write-up in the trade press.
 *
 * The test is "would a CEO forward this to another CEO", not "is this about their field".
 */
export const STATURE_FLOOR = 0.5;

/** Kinds that satisfy the flagship half of a run's acceptance criterion. */
export const FLAGSHIP_KINDS: readonly ItemKind[] = ["research", "big_news", "company_move"] as const;

/**
 * Stage 2 output: would a well-read person forward this to someone they know?
 *
 * This replaced `isLaunch`. The old field asked whether an item was a product launch
 * and the prompt explicitly REJECTED research, surveys, analysis and commentary — the
 * exact inverse of what a relationship radar wants. The first production run returned
 * eleven vendor launches and nothing else; the filter was working perfectly, at the
 * wrong job.
 */
export type TriageVerdict = {
  url: string;
  /** 0-1. Forwardable to a colleague, unprompted, with no agenda. */
  shareworthy: number;
  /**
   * 0-1. How much WEIGHT the item carries, independent of how relevant it is.
   * A correct-subject, low-stature item is the failure mode this exists to catch.
   */
  stature: number;
  kind: ItemKind;
  /** Who published it. A vendor publishing about itself is promotion until proven otherwise. */
  publisher: string | null;
  /** True when everyone in the field has already seen it — forwarding it says "I don't follow your field". */
  staleness: boolean;
  /**
   * True when the item is ABOUT the Israeli market or an Israeli company, whoever
   * published it. Separate from the publisher's host: decrypt.co covering Bank Leumi is
   * the case that host-matching alone gets wrong, and it was the one usable gift of the
   * 2026-08-26 run. See lib/tech-radar/acceptance.ts.
   */
  israelRelevant: boolean;
  /** Coarse tags used to prefilter items against a company's focus areas. */
  categories: string[];
  /**
   * Members of the industry pack's CLOSED taxonomy — the person-outward matching key
   * (v3 Phase B). Distinct from `categories`, which stays free text because the
   * company-outward path in fit.ts scores it by token overlap; that overlap is exactly
   * what fails on synonyms, which is why the person path gets a closed list instead.
   *
   * ABSENT means no taxonomy was offered (the company path, and every verdict written
   * before Phase B). An empty ARRAY means one was offered and nothing matched — a
   * finding, and the row a future threshold calibration reads. Collapsing the two would
   * make a run with no source pack look identical to a run where every item missed.
   */
  industryTags?: string[];
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
  /** Carried from the triage verdict so a discard can be explained after the fact. */
  shareworthy: number;
  stature: number;
  kind: ItemKind;
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
/** Caps `industry.queries` — the prompt asks the model for "3-5 BROAD industry-level search queries". */
export const MAX_INDUSTRY_QUERIES = 5;
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
  /** Person-level stages. Separate keys so the veto's cost is visible on its own —
   *  it runs on Opus rather than Haiku, so it is the expensive line. */
  personProfile: "tech-radar-person-profile",
  axisFit: "tech-radar-axis-fit",
  axisMerge: "tech-radar-axis-merge",
  veto: "tech-radar-veto",
  /** The veto's person-specificity bar, moved to profile build time. */
  rationaleGate: "tech-radar-rationale-gate",
  /** Floor 2 of the v3 matching pyramid: one Haiku call per person per scan. Its own key
   *  so ~8 cheap calls a scan never hide inside triage's line in the spend log. */
  chooser: "tech-radar-chooser",
} as const;
