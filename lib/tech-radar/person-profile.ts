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

/**
 * Which of the four staged questions produced an axis.
 *
 * A per-axis source tag, because "נגזר מהתפקיד ומהחברה" is a tag that distinguishes
 * nothing — and because stage (ד), the adoption question, produced ZERO axes for all four
 * people in the 2026-08-26 run. Without a tag that failure is invisible: a run that never
 * asks the fourth question and a run whose fourth-question axes were all killed look
 * identical in the report.
 */
export const AXIS_STAGES = ["decision", "competitor", "stop_and_read", "adopt"] as const;
export type AxisStage = (typeof AXIS_STAGES)[number];
const STAGE_SET: ReadonlySet<string> = new Set<string>(AXIS_STAGES);

export type AxisProposal = {
  label: string;
  key: string;
  searchQueries: string[];
  /** Why this axis is THIS person's. Becomes PersonAxis.rationale and feeds the veto. */
  rationale: string;
  /**
   * The two sides of the crossing, DECLARED rather than inferred from the rationale.
   *
   * The 2026-08-26 run produced unions: a CITO got his employer's four technical axes,
   * because "the decision this person holds" and "who this company's customers and rivals
   * are" existed only as prose inside one Hebrew sentence, and no rule can read which half
   * of a sentence is which. Declared, each side can be checked — see declaresPersonSide
   * and declaresCompanySide in lib/tech-radar/rationale-rules.ts.
   *
   * Deliberately NOT required by the parser: an axis that declares nothing is kept here
   * and rejected by the gate, so the report can say `no_person_side` instead of counting
   * it in an anonymous "no usable axis" total.
   */
  personDecision: string;
  companyFact: string;
  /** Which staged question this axis came from. Required — an axis without one is dropped. */
  stage: AxisStage;
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

THINK IN STAGES, in writing, BEFORE deriving a single axis. Answer FIVE questions, in Hebrew:

(א) Which decisions does this person actually hold — what do they sign? Read the FULL title. A VP Product signs product and customer-experience decisions; a Head of Retail Banking signs the retail offering; a Director of Innovation signs what the company adopts next; only a CIO/CTO signs infrastructure. Core-systems modernization is the CIO's subject — giving it to a product or retail executive is the failure this stage exists to prevent.

(ב) Who is trying to eat their customers, and what would stress this person if it happened tomorrow morning? Use the named competitors — a rival launching into exactly this person's territory is the strongest signal there is.

(ג) What would they stop everything to read, and forward to a colleague?

(ד) What is being done WELL SOMEWHERE ELSE — in another market, or in a different industry entirely — that this person could adopt? This is a different appetite from (ב): (ב) is "who is attacking me", this is "show me what is possible". A CIO wants consumer-grade products from other industries he could bring into his own; a head of retail banking wants what consumer lending, savings and investing look like in banks abroad. An axis from this stage is about opportunity, not threat.

(ה) THE SWAP TEST. Apply it to every candidate subject from (א)-(ד) BEFORE you derive a single axis. Two swaps, and the subject must fail both:
   1. SWAP THE PERSON — same company, a different executive in a different chair. If the subject still fits them, it is the COMPANY'S subject and not this person's. "מודרניזציה של מערכות ליבה", "תשלומים בזמן אמת" and "ארכיטקטורת API פתוחה" fit a bank's CITO, its head of retail banking and its CFO alike — which is exactly how one CITO was handed four axes that any CITO at any bank would have been handed.
   2. SWAP THE COMPANY — same title, a company in a different industry. If the subject still fits, it is the TITLE'S subject and not an intersection: "זיהוי הונאות" moves from a bank to an insurer without changing a word, so it was never crossed with anything.
   A subject that SURVIVES EITHER swap is discarded here and never becomes an axis. Only a subject that BREAKS UNDER BOTH is a real intersection — it stops making sense if you move either the person or the company, because it needs this person's decision AND this company's customers or named rivals to exist at all.
   This applies to the stage-(ד) adoption subjects too, and it is what makes them survivable: "מה שעושים היטב במקום אחר" becomes THIS person's subject only once it is crossed with who this company's customers are or which named rival already did it. Uncrossed, it fits any holder of the title anywhere, survives the company swap, and falls.
   In the reasoning, write ONE short line per surviving subject: what breaks under each swap.

Return these answers as "reasoning", IN HEBREW, at most THREE SENTENCES PER STAGE — except (ה), which is one short line per surviving subject. Brevity is not cosmetic: the reasoning and the axes share one output budget, and an essay here leaves no room for the axes themselves. It is saved next to the profile so a human can see how you reached the axes — reasoning that could have been written without reading the title is a failed answer.

Then return:

1. roleLens — one Hebrew sentence: what decisions or problems does THIS person own? Be concrete about the job, not the company. "אחראי על מנוע ההמלצות ועל איכות הדירוג" is a role lens. "עובד בחברת ספורט" is not.

2. axes — 3 to 5 subjects DERIVED FROM YOUR STAGED ANSWERS, that this person would read about. EXACTLY ONE of them must have "agenda": true, and the rest "agenda": false. Cover stage (ד) with at least one axis: an adoption axis is not optional.

   RATIONALE RULES. These are enforced by code, not judgement — a rationale that breaks one does not get softened, the AXIS IS DELETED. So spend the effort here even on the axes that feel obvious:
   - It must point at one of your staged answers: "כי הוא מחזיק את החלטת X", "כי Y מתחרה על הלקוחות שלו". A rationale that describes a domain — "כי הוא בבנקאות" — is discarded.
   - It must name BOTH SIDES of the crossing in the sentence itself: which decision of THIS person, and which fact about THIS company — a customer segment, or a rival BY NAME — that decision met. A rationale that names only one side is an admission that no crossing happened, and the axis is deleted. "כי היא מחזיקה את החלטת האשראי הצרכני, בזמן שלאומי משיק אשראי מיידי לאותם לקוחות" names both. "כי היא מחזיקה את החלטת האשראי הצרכני" names one.
   - NEVER open with the job title. "כ-CITO של בנק גדול, רחמיל חתום על…" and "כראש בנקאות קמעונאית, פזית…" are both DELETED on sight. Say what the person holds, not what they are called. Start with "כי".
   - Every company name you write MUST come from the employer's named competitors given to you. A name that is not in that list deletes the axis. Do not reach for a plausible-sounding Israeli company; "ראשון לציון" is a city, and an invented rival in a message to a board member cannot be taken back.
   - Do not build an axis on a subject your own reasoning said is NOT this person's. If you wrote that core-systems modernization belongs to the CTO, an axis about core-systems modernization is deleted.

   The AGENDA axis is derived from what the company is DOING NOW — a project, an expansion, an acquisition, a regulatory exposure, a market they just entered, a facility they announced. Take it from the employer profile. It must be something a colleague with a different title at the same company would ALSO care about, but that a person with the same title at a DIFFERENT company would not.
   - AGENDA: "הרחבת קיבולת הזיקוק שהוכרזה ברבעון האחרון", "כניסה לשוק ההודי", "עסקת הרכישה שממתינה לאישור רגולטורי"
   - NOT AGENDA, this is a role: "מרווחי זיקוק", "ניהול עלויות הפעלה", "בקרת איכות"

   For every axis:
   - stage: which staged question this axis came from — "decision" for (א), "competitor" for (ב), "stop_and_read" for (ג), "adopt" for (ד). Exactly one of those four words. "נגזר מהתפקיד ומהחברה" is not a stage: it distinguishes nothing, and an axis that cannot name its stage is deleted.
   - personDecision: the person side of the crossing, in Hebrew — the decision they sign, the budget they hold, the asset they carry. Say what they HOLD, never what they are CALLED: "חתום על ארכיטקטורת הליבה ועל תקציב הסייבר" is a decision; "ראש בנקאות קמעונאית" is a chair, and the axis is deleted.
   - companyFact: the company side, in Hebrew — either the customer segment this decision met ("לקוחות פרטיים שנוטלים הלוואות וחוסכים", "מבוטחי הביטוח הסיעודי", "עסקים קטנים") or a competitor BY NAME from the list you were given. A technology is not a fact about the company: "ארכיטקטורת API פתוחה" and "תקני KYC" delete the axis. So does a rival whose name is not in that list.
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
{"reasoning":"...","roleLens":"...","axes":[{"label":"...","stage":"decision"|"competitor"|"stop_and_read"|"adopt","personDecision":"...","companyFact":"...","agenda":true,"searchQueries":["..."],"rationale":"..."}]}`;

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
  return parseProfileResponseWithReason(text).draft;
}

/**
 * The same parse, with the reason it came back empty.
 *
 * Gil Tamir's 2026-08-26 brain call spent 2045 output tokens and produced nothing, and
 * the log could only say "failed or returned no reasoning" — four different gates, one
 * message, no way to tell which. A null that cannot say why costs a paid re-run to
 * diagnose, which is the expensive kind of silence.
 */
export function parseProfileResponseWithReason(
  text: string
): { draft: PersonProfileDraft | null; reason: string | null } {
  const parsed = parseJsonLoose<{ reasoning?: unknown; roleLens?: unknown; axes?: unknown }>(text);
  if (!parsed) return { draft: null, reason: "response was not parseable JSON" };
  const roleLens = str(parsed?.roleLens);
  if (!roleLens) return { draft: null, reason: "no roleLens in the response" };
  // No reasoning, no profile: a model that skipped the stages is the old brain with a
  // new name, and the caller records profile_call_failed rather than building blind.
  const reasoning = str(parsed?.reasoning);
  if (!reasoning) return { draft: null, reason: "no reasoning — the staged thinking was skipped" };

  const rows = Array.isArray(parsed?.axes) ? parsed.axes : [];
  const axes: AxisProposal[] = [];
  const seen = new Set<string>();
  /** Which requirement each dropped axis failed, so the empty case names itself. */
  const dropped: Record<string, number> = {};
  const drop = (why: string) => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };

  for (const row of rows) {
    const o = row as Record<string, unknown>;
    const label = str(o.label);
    const key = normalizeAxisKey(label);
    // No key, no axis. Also collapses a model proposing the same subject twice.
    if (!key || seen.has(key)) {
      drop(key ? "duplicate" : "label");
      continue;
    }
    const rationale = str(o.rationale);
    if (!rationale) {
      drop("rationale");
      continue;
    }
    // The stage tag is enforced HERE and not in the gate because it needs nothing but the
    // four allowed words, while both declared sides need the employer's competitors and
    // segments to judge — which only the gate has. An unrecognised value is not coerced
    // into one of the four: a defaulted source tag is a tag that distinguishes nothing,
    // which is the whole reason this field exists.
    const stage = str(o.stage);
    if (!STAGE_SET.has(stage)) {
      drop("stage");
      continue;
    }

    const searchQueries = Array.isArray(o.searchQueries)
      ? [...new Set(o.searchQueries.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean))]
      : [];
    // An axis with no queries can never surface anything, so it is not an axis.
    if (searchQueries.length === 0) {
      drop("searchQueries");
      continue;
    }

    seen.add(key);
    axes.push({
      label,
      key,
      searchQueries,
      rationale,
      // Kept even when empty: the gate rejects them by name, which is how the report can
      // say WHICH side the brain failed to declare instead of an anonymous shortfall.
      personDecision: str(o.personDecision),
      companyFact: str(o.companyFact),
      stage: stage as AxisStage,
      agenda: o.agenda === true,
    });
    if (axes.length >= MAX_AXES_PER_PERSON) break;
  }

  if (axes.length === 0) {
    const why = Object.entries(dropped)
      .map(([k, n]) => `${k}=${n}`)
      .join(", ");
    return {
      draft: null,
      reason: `no usable axis out of ${rows.length} proposed (each needs a label, a rationale, a stage tag and at least one query)${why ? ` — failed: ${why}` : ""}`,
    };
  }
  // Exactly one agenda axis. If the model marked several, the first wins; if it marked
  // none, the first axis is promoted rather than leaving the person with role axes only
  // — the whole point is that at least one axis is not derivable from a job title.
  let seenAgenda = false;
  for (const a of axes) {
    if (a.agenda && !seenAgenda) seenAgenda = true;
    else a.agenda = false;
  }
  if (!seenAgenda) axes[0].agenda = true;
  return { draft: { reasoning, roleLens, axes }, reason: null };
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
      // The staged reasoning and the axes share this budget. At 2000 the first live run
      // came back truncated at exactly the cap, and Erez Rachmil got 2 axes instead of
      // 3-5 — the reasoning had eaten the room. The prompt also caps each stage at three
      // sentences; both levers are needed. Raised again for the swap test: a fifth stage
      // plus two declared sides per axis is more output for the same axes, and a cap only
      // costs what is actually generated — whereas truncation costs the whole call.
      max_tokens: 5000,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 30_000 }
  );
  if (!res.ok) {
    console.warn(`[radar] person-profile call FAILED for ${input.fullName}: ${res.status + " " + res.detail}`);
    return null;
  }

  // A truncated response is the failure mode that produced 2 axes instead of 3-5 on the
  // first live run, and it looks exactly like a model that had little to say. Say it
  // instead of leaving it to be noticed in a token count.
  const finish = res.data.choices?.[0]?.finish_reason;
  if (finish === "length") {
    console.warn(
      `[radar] person-profile TRUNCATED for ${input.fullName} — raise max_tokens or shorten the reasoning`
    );
  }
  const { draft, reason } = parseProfileResponseWithReason(res.data.choices?.[0]?.message?.content ?? "");
  if (!draft) console.warn(`[radar] person-profile EMPTY for ${input.fullName}: ${reason}`);
  return draft;
}

/** Truncate a learned note at a word boundary rather than mid-word. */
export function clampPersonalNotes(note: string): string {
  const t = (note ?? "").trim();
  if (t.length <= MAX_PERSONAL_NOTES) return t;
  const cut = t.slice(0, MAX_PERSONAL_NOTES);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_PERSONAL_NOTES * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}
