/**
 * Build the person model: what this person owns, and which interests are theirs.
 *
 * One LLM call per person, crossing their role with their employer's research profile.
 * The employer's profile is CONTEXT for the question "what does this person own?", not
 * the answer — the whole failure of v1 was answering with the company.
 *
 * Every proposed axis passes the merge gate BEFORE insert, so a person attaches to a
 * surviving axis rather than minting a synonym. An org whose axes each have one
 * subscriber has per-person fit with extra steps, and none of the cost saving.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";
import { normalizeAxisKey, MAX_AXES_PER_PERSON } from "@/lib/tech-radar/axis";

const MODEL = process.env.TECH_RADAR_MODEL ?? "anthropic/claude-haiku-4.5";

/** 400 chars, per the spec: a note about a person, not a dossier on them. */
export const MAX_PERSONAL_NOTES = 400;

export type AxisProposal = {
  label: string;
  key: string;
  searchQueries: string[];
  /** Why this axis is THIS person's. Becomes PersonAxis.rationale and feeds the veto. */
  rationale: string;
  /**
   * True for an axis derived from what the company is doing NOW, rather than from the
   * job description. "מרווחי זיקוק" is a role. "הרחבת בית הזיקוק שהכריזו עליה ברבעון"
   * is an agenda — and only the second gives the veto something a colleague with the
   * same title would not also have.
   */
  agenda: boolean;
};

export type PersonProfileDraft = {
  /** The staged thinking that produced the axes. Saved so a human can audit the path. */
  reasoning: string;
  roleLens: string;
  axes: AxisProposal[];
};

export const PROFILE_SYSTEM = `You describe what ONE person owns at work, and which subjects would make them stop and read.

You are given the person's full title and headline, and the commercial picture of their employer: what the company sells and to whom, its competitors BY NAME, and what it is doing right now. The employer picture is CONTEXT for understanding what this person's job actually involves. A description of the company as an answer to "what does this person own" is a failed answer.

THINK IN STAGES, in writing, BEFORE deriving a single axis. Answer three questions, in Hebrew:

(א) Which decisions does this person actually hold — what do they sign? Read the FULL title. A VP Product signs product and customer-experience decisions; a Head of Retail Banking signs the retail offering; a Director of Innovation signs what the company adopts next; only a CIO/CTO signs infrastructure. Core-systems modernization is the CIO's subject — giving it to a product or retail executive is the failure this stage exists to prevent.

(ב) Who is trying to eat their customers, and what would stress this person if it happened tomorrow morning? Use the named competitors — a rival launching into exactly this person's territory is the strongest signal there is.

(ג) What would they stop everything to read, and forward to a colleague?

Return these answers as "reasoning". It is saved next to the profile so a human can see how you reached the axes — reasoning that could have been written without reading the title is a failed answer.

Then return:

1. roleLens — one Hebrew sentence: what decisions or problems does THIS person own? Be concrete about the job, not the company. "אחראי על מנוע ההמלצות ועל איכות הדירוג" is a role lens. "עובד בחברת ספורט" is not.

2. axes — 3 to 5 subjects DERIVED FROM YOUR STAGED ANSWERS, that this person would read about. EXACTLY ONE of them must have "agenda": true, and the rest "agenda": false. Every rationale must point at one of your staged answers — "כי הוא מחזיק את החלטת X", "כי Y מתחרה על הלקוחות שלו". A rationale that describes a domain — "כי הוא בבנקאות" — fails a downstream gate and the axis is discarded.

   The AGENDA axis is derived from what the company is DOING NOW — a project, an expansion, an acquisition, a regulatory exposure, a market they just entered, a facility they announced. Take it from the employer profile. It must be something a colleague with a different title at the same company would ALSO care about, but that a person with the same title at a DIFFERENT company would not.
   - AGENDA: "הרחבת קיבולת הזיקוק שהוכרזה ברבעון האחרון", "כניסה לשוק ההודי", "עסקת הרכישה שממתינה לאישור רגולטורי"
   - NOT AGENDA, this is a role: "מרווחי זיקוק", "ניהול עלויות הפעלה", "בקרת איכות"

   For every axis:
   - label: 2-5 Hebrew words naming the subject. Rich enough to be distinguishable — "זיהוי הונאות בתשלומים", not "הונאות". Never a single generic word like "פינטק": a subject most of an industry shares will be discarded.
     This label is shown to the user as it is written. Proofread it before returning: correct Hebrew spelling and grammar, no truncated or invented words (write "והגנה", never "וגנת"), single spaces, no trailing full stop, and a hyphen or space between Hebrew and any Latin name ("אדריכלות API", never "אדריכלותAPI").
   - rationale: one Hebrew sentence saying why this subject is THIS PERSON'S. It must point at a decision they make, a project they run, an asset they are responsible for, or a problem they personally carry — NOT at their job title. A sentence that begins "כ-VP Assets, אחראי על…" is a restatement of the title and will be rejected downstream. A sentence that names a specific field, product, facility, market or decision will not.
   - searchQueries: 2-4 web-search queries. They decide what this person actually receives, so aim them at material with WEIGHT:
     * Aim at flagship reports, industry studies, regulatory moves, market moves and serious business news. NOT at product launches, vendor announcements, or write-ups of individual tools — those are filtered out later, so a query that finds them wastes the run.
     * When an axis is about competitor or market moves, its queries MUST carry the competitors' actual names from the employer picture ("Lemonade new insurance products", "לאומי דיגיטל השקה"). The names are the monitoring mechanism — a generic "competitors" query finds nothing.
     * If the person or the company is Israeli, AT LEAST ONE query per axis must be IN HEBREW, phrased the way Israeli business press writes — that is what surfaces Globes, Calcalist, TheMarker and Bizportal, and local news is the most forwardable material there is. Do NOT use "site:" operators; plain Hebrew works better.
     * Other queries in English, two to four words at the core.
     * For a report-hunting query, name the kind of thing: "outlook report", "industry survey", "regulatory ruling", "market outlook".

Return strict JSON only — no prose, no fences:
{"reasoning":"...","roleLens":"...","axes":[{"label":"...","agenda":true,"searchQueries":["..."],"rationale":"..."}]}`;

export type PersonProfileInput = {
  fullName: string;
  currentTitle: string | null;
  headline: string | null;
  companyName: string;
  /** The employer's research profile, as context only. */
  employerProfile: unknown;
};

/** A string[] out of an unknown, for reading legacy profiles defensively. */
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/**
 * The commercial picture as FIRST-CLASS lines, not buried in a JSON slice. The staged
 * thinking is only as good as what it can see: a 2500-char JSON.stringify routinely cut
 * exactly the fields the stages need. Legacy profiles (researched before the required
 * fields existed) simply contribute fewer lines — never a crash.
 */
export function personPromptInput(i: PersonProfileInput): string {
  const p = (i.employerProfile ?? {}) as Record<string, unknown>;
  const whatTheySell = typeof p.whatTheySell === "string" ? p.whatTheySell.trim() : "";
  const segments = strList(p.customerSegments);
  const competitors = strList(p.namedCompetitors);
  const noClear = p.noClearCompetitors === true;
  const noClearReason = typeof p.noCompetitorsReason === "string" ? p.noCompetitorsReason.trim() : "";
  const initiatives = strList(p.digitalInitiatives);
  const focusAreas = Array.isArray(p.focusAreas)
    ? p.focusAreas
        .map((f) => (f as Record<string, unknown>)?.area)
        .filter((a): a is string => typeof a === "string" && a.trim() !== "")
    : [];

  return [
    `Person: ${i.fullName}`,
    `Title: ${i.currentTitle ?? "unknown"}`,
    i.headline ? `Headline: ${i.headline}` : null,
    `Employer: ${i.companyName}`,
    whatTheySell ? `What the employer sells, and to whom: ${whatTheySell}` : null,
    segments.length ? `Customer segments: ${segments.join(", ")}` : null,
    competitors.length ? `Named competitors: ${competitors.join(", ")}` : null,
    noClear ? `Competitors: none found — explicit finding: ${noClearReason || "(no reason recorded)"}` : null,
    initiatives.length || focusAreas.length
      ? `What occupies the employer now: ${[...initiatives, ...focusAreas].join("; ")}`
      : null,
    `Full employer research profile (context only): ${JSON.stringify(i.employerProfile).slice(0, 2500)}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Pure. Drops any axis whose label normalises to nothing — a label made only of filler
 * ("תחום", "עולם") is not an interest, and letting one through creates an axis that
 * every future proposal collides with.
 */
export function parseProfileResponse(text: string): PersonProfileDraft | null {
  const parsed = parseJsonLoose<{ reasoning?: unknown; roleLens?: unknown; axes?: unknown }>(text);
  const roleLens = str(parsed?.roleLens);
  if (!roleLens) return null;
  // No reasoning, no profile: a model that skipped the stages is the old brain with a
  // new name, and the caller records profile_call_failed rather than building blind.
  const reasoning = str(parsed?.reasoning);
  if (!reasoning) return null;

  const rows = Array.isArray(parsed?.axes) ? parsed.axes : [];
  const axes: AxisProposal[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const o = row as Record<string, unknown>;
    const label = str(o.label);
    const key = normalizeAxisKey(label);
    // No key, no axis. Also collapses a model proposing the same subject twice.
    if (!key || seen.has(key)) continue;
    const rationale = str(o.rationale);
    if (!rationale) continue;

    const searchQueries = Array.isArray(o.searchQueries)
      ? [...new Set(o.searchQueries.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean))]
      : [];
    // An axis with no queries can never surface anything, so it is not an axis.
    if (searchQueries.length === 0) continue;

    seen.add(key);
    axes.push({ label, key, searchQueries, rationale, agenda: o.agenda === true });
    if (axes.length >= MAX_AXES_PER_PERSON) break;
  }

  if (axes.length === 0) return null;
  // Exactly one agenda axis. If the model marked several, the first wins; if it marked
  // none, the first axis is promoted rather than leaving the person with role axes only
  // — the whole point is that at least one axis is not derivable from a job title.
  let seenAgenda = false;
  for (const a of axes) {
    if (a.agenda && !seenAgenda) seenAgenda = true;
    else a.agenda = false;
  }
  if (!seenAgenda) axes[0].agenda = true;
  return { reasoning, roleLens, axes };
}

export async function buildPersonProfile(input: PersonProfileInput): Promise<PersonProfileDraft | null> {
  const res = await openrouterChat(
    OR_FEATURE.personProfile,
    {
      model: MODEL,
      messages: [
        { role: "system", content: PROFILE_SYSTEM },
        { role: "user", content: personPromptInput(input) },
      ],
      temperature: 0.3,
      max_tokens: 2000, // the staged reasoning is part of the output now
      response_format: { type: "json_object" },
    },
    { timeoutMs: 30_000 }
  );
  if (!res.ok) return null;
  return parseProfileResponse(res.data.choices?.[0]?.message?.content ?? "");
}

/** Truncate a learned note at a word boundary rather than mid-word. */
export function clampPersonalNotes(note: string): string {
  const t = (note ?? "").trim();
  if (t.length <= MAX_PERSONAL_NOTES) return t;
  const cut = t.slice(0, MAX_PERSONAL_NOTES);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_PERSONAL_NOTES * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}
