/**
 * Floor 2 of the matching pyramid: the chooser.
 *
 * ONE Haiku call per person per scan. It is handed the whole person — what they own and
 * what they explicitly do NOT own, who their customers are, what is on their agenda right
 * now, how they got to their chair — plus every item that cleared the floors, and it
 * answers one question: which of these, if any, would this particular person actually want
 * to receive?
 *
 * Why a floor of its own, between two that already exist:
 *   floor 1 (`match-floors.ts`) is tuned for RECALL and says so — an entity hit or a single
 *     focused tag makes an item a candidate. It prevents a MISS.
 *   floor 2, here, prevents MEDIOCRITY. Tag overlap cannot tell "the exact thing she is
 *     living through this quarter" from "a competent article about her field", and the
 *     user's complaint on 2026-08-31 was precisely that: "הכתבות חלשות או לא מעניינות".
 *   floor 3 (`veto.ts`) prevents a FAKE, on Opus, unchanged.
 *
 * Cost, stated because it is the reason this is one call and not one per pair: ~8 calls per
 * weekly scan for the pilot org, ~$0.02 total. A per-pair chooser would be ~200 calls for
 * the same information — the person is the same in all of them, and comparing candidates
 * AGAINST EACH OTHER is most of the judgement. Ranking needs them in one context.
 *
 * Three bugs from the 2026-08-31 live run are answered explicitly below, at `chooserMaxTokens`
 * (a truncated body is billed in full), at `CHOOSER_TIMEOUT_MS` (an AbortError mid-generation
 * is also billed in full) and at `line()` (`??` does not fall through for a helper that
 * returns "").
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";
import type { PersonAudience, PersonScope } from "@/lib/tech-radar/person-profile";

/**
 * Haiku, and its OWN env var.
 *
 * Same pattern as `PROFILE_MODEL`: one dedicated knob, one default in code. Deliberately
 * NOT falling back to `TECH_RADAR_MODEL` the way triage does — that knob belongs to triage,
 * and moving triage's model for a chunking experiment must not silently move the chooser
 * onto a model whose judgement nobody looked at.
 *
 * Read at CALL time rather than at module load, which is `floorThresholds()`'s discipline:
 * a one-off run can then set the model on the command that runs the scan, the way
 * RADAR_MAX_DRAFTS_PER_DAY is passed and never set on the container.
 */
export const CHOOSER_MODEL_DEFAULT = "anthropic/claude-haiku-4.5";

export function chooserModel(): string {
  // `||`, not `??`: an env var set to the empty string in a Coolify UI field is "unset" to
  // a human and "" to `??`, which would send `model: ""` to OpenRouter.
  return process.env.TECH_RADAR_CHOOSER_MODEL || CHOOSER_MODEL_DEFAULT;
}

/**
 * At most three, and the spec's own words are "עד 2-3 מועמדים לאדם לריצה, במקום אחד".
 *
 * The cap is on what the chooser may propose, not on what is sent: pacing now happens at
 * send-release (Task 10), so three picks is three drafts queued, not three messages today.
 */
export const MAX_PICKS = 3;

/**
 * 180 seconds.
 *
 * A 90s ceiling produced an `AbortError` mid-generation in the 2026-08-31 run, and the
 * money was already spent — `openrouterChat` charges for a request whether the client
 * waits for it or not, and the abort discards a completed judgement. Same arithmetic as
 * triage's 120s: the ceiling has to fit the work, and the work here is one model reading a
 * full profile plus up to a few dozen candidates before it writes anything.
 */
export const CHOOSER_TIMEOUT_MS = 180_000;

/**
 * Output budget. Generous ON PURPOSE and sized to the candidate count.
 *
 * The 2026-08-31 lesson, for the third time in this codebase (triage, then the veto, then
 * the profile builder): `max_tokens` too low does not return a short answer, it returns a
 * body cut off mid-JSON that parses to nothing — and the call is billed in full. Output
 * tokens are the cheap half of the bill; a truncated answer costs the whole call plus the
 * person's whole scan.
 *
 * The number grows with the candidate count even though the answer is capped at three
 * picks, because a model handed forty items routinely narrates its way through them before
 * committing. A ceiling is not a charge.
 */
const TOKENS_OVERHEAD = 1200;
const TOKENS_PER_CANDIDATE = 100;

export function chooserMaxTokens(candidateCount: number): number {
  return TOKENS_OVERHEAD + Math.max(0, candidateCount) * TOKENS_PER_CANDIDATE;
}

/**
 * The person, as the chooser sees them. Structural rather than the Prisma row: the caller
 * (Task 9) does the joins, and this module stays callable from a test with no database.
 */
export type ChooserPerson = {
  fullName: string;
  currentTitle?: string | null;
  employer?: string | null;
  /** PersonProfile.roleLens — what kind of decisions they own, in their own terms. */
  roleLens?: string | null;
  /** Who they serve. Null for a legacy profile built before v3 required it. */
  audience?: PersonAudience | null;
  /** owns / notOwns. `notOwns` already killed items at floor 0; it is here so the chooser
   *  does not rank up an item that merely brushes a line they do not hold. */
  scope?: PersonScope | null;
  /** The ONE axis marked `agenda` — what they are living through right now. */
  agenda?: { label: string; personDecision?: string | null; dateIso?: string | null } | null;
  /** Computed in `career.ts`, never guessed. Labelled COMPUTED in the prompt. */
  career?: {
    tenureYearsInCurrentRole: number | null;
    path: { title: string; company: string | null; years: number | null }[];
  } | null;
  /** Learned from past feedback. Capped upstream. */
  personalNotes?: string | null;
};

/** One item that cleared the floors. `itemId` is the id the picks are validated against. */
export type ChooserCandidate = {
  itemId: string;
  title: string;
  summary?: string | null;
  url?: string | null;
  publisher?: string | null;
  kind?: string | null;
  publishedAt?: string | null;
  /** Floor 1's tier, verbatim: entity | focused | broad. */
  tier?: string | null;
  /** What matched, in the PERSON's spelling — `TagOverlap.matched`. */
  matched?: string[];
  /** Triage's stature, so weight is visible without the chooser re-judging it. */
  stature?: number | null;
};

export type ChooserPick = { itemId: string; why: string };

/**
 * `outcome` is why `picks` is empty, and it exists for the reason `VetoVerdict.outcome`
 * exists: on 2026-08-23 three truncated-JSON faults were displayed as if the gate had
 * thought about them. "Nothing was worth forwarding" is a finding about the sources;
 * "the answer did not parse" is a bug. Recorded separately or neither is ever fixed.
 */
export type ChooserOutcome = "judged" | "none" | "parse_failed" | "unavailable";

export type ChooserResult = {
  picks: ChooserPick[];
  /** Set ONLY when `picks` is empty. Hebrew, and shown to the reviewer as-is. */
  noneReason?: string;
  outcome: ChooserOutcome;
};

export const CHOOSER_SYSTEM = `You choose what ONE specific person would actually want to receive this week.

You are given a full picture of that person and a list of news items. Every item already passed a cheap tag filter. That filter is generous by design — it exists to prevent a MISS, and it cannot tell "the exact thing this person is dealing with right now" from "a competent article about their field". Telling those apart is your entire job.

Pick at most ${MAX_PICKS}, best first. Pick FEWER when fewer are worth it, and pick NOTHING when nothing is: an empty picks array with a noneReason is a correct, expected, legitimate answer, and it is recorded as a decision. A weak forward costs a relationship; a week of silence costs nothing.

PICK an item when you can name what makes it land for THIS person:
- it touches something they own, in the market they serve
- it is about a name they watch — a competitor, their regulator, a product on their agenda
- it is a real finding, a regulatory move with teeth, or a market event inside their scope
- someone in their chair would forward it to a peer unprompted

DO NOT PICK:
- anything that would be equally interesting to anyone with the same job title
- a restatement of their employer's business
- a vendor describing its own product
- an item about a line they do not own, even when it is about their industry
- an item from another market that does not travel

why — ONE short sentence in Hebrew, casual, the way you would say it out loud. Say what makes it theirs, not what the article is. No emoji, no icons, ever. Write gender-neutral Hebrew: the person may be a woman or a man and the same sentence has to fit either.

noneReason — one short Hebrew sentence, same rules, saying what was missing. Only when you pick nothing.

itemId — copy it character for character from the list. Never invent one, never edit one: an id that is not on the list is discarded, so it buys nothing.

Return strict JSON only — no prose, no fences:
{"picks":[{"itemId":"<copied exactly>","why":"..."}],"noneReason":"..."}`;

// ─── the person block ────────────────────────────────────────────────────────

/**
 * A labelled line, or the explicit stand-in when the value is missing.
 *
 * `||` and not `??` — the third bug of the 2026-08-31 run. Every helper below returns ""
 * for "nothing to say", and `??` falls through only for null/undefined, so an empty scope
 * rendered as a blank "Scope:" line. A model reads a blank line as a fact ("she owns
 * nothing"), which is a claim no research ever made. An absent field must SAY it is absent.
 */
function line(label: string, value: string, missing: string): string {
  return `${label}: ${value || missing}`;
}

function joinList(v: unknown, sep = ", "): string {
  return Array.isArray(v)
    ? v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean)
        .join(sep)
    : "";
}

function audienceText(a: PersonAudience | null | undefined): string {
  if (!a) return "";
  const parts = [joinList(a.type, "/"), typeof a.who === "string" ? a.who.trim() : "", typeof a.geography === "string" ? a.geography.trim() : ""];
  return parts.filter(Boolean).join(" — ");
}

function agendaText(agenda: ChooserPerson["agenda"]): string {
  if (!agenda) return "";
  const label = typeof agenda.label === "string" ? agenda.label.trim() : "";
  if (!label) return "";
  const extras = [agenda.personDecision, agenda.dateIso]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  return extras.length > 0 ? `${label} (${extras.join(", ")})` : label;
}

/** COMPUTED, and labelled so: an unknown tenure is written "unknown", never a plausible
 *  number — the same rule `readCareer` states in person-profile.ts. */
function careerText(c: ChooserPerson["career"]): string {
  if (!c) return "";
  const tenure = c.tenureYearsInCurrentRole == null ? "unknown" : `${c.tenureYearsInCurrentRole} years`;
  const path = (Array.isArray(c.path) ? c.path : [])
    .map((p) => {
      const title = typeof p?.title === "string" ? p.title.trim() : "";
      if (!title) return "";
      const company = typeof p?.company === "string" && p.company.trim() ? ` @ ${p.company.trim()}` : "";
      const years = typeof p?.years === "number" && Number.isFinite(p.years) ? ` (${p.years}y)` : "";
      return `${title}${company}${years}`;
    })
    .filter(Boolean)
    .join(" ← ");
  return path ? `tenure in current role ${tenure}; path: ${path}` : `tenure in current role ${tenure}`;
}

function personBlock(p: ChooserPerson): string {
  const scope = p.scope ?? null;
  return [
    `PERSON: ${p.fullName}`,
    line("Title", typeof p.currentTitle === "string" ? p.currentTitle.trim() : "", "unknown"),
    line("Employer", typeof p.employer === "string" ? p.employer.trim() : "", "unknown"),
    line("What they own", joinList(scope?.owns), "not researched — do not assume"),
    line("What they do NOT own", joinList(scope?.notOwns), "not researched — do not assume"),
    line("Who they serve", audienceText(p.audience), "not researched — do not assume"),
    line("How they see their role", typeof p.roleLens === "string" ? p.roleLens.trim() : "", "not researched"),
    line("On their agenda now", agendaText(p.agenda), "nothing recorded"),
    line("Career (COMPUTED, trust it)", careerText(p.career), "not computed"),
    line("Notes about them", typeof p.personalNotes === "string" ? p.personalNotes.trim() : "", "none"),
  ].join("\n");
}

/**
 * The candidates, numbered, each led by its id.
 *
 * `itemId=` first on the line for the reason triage puts `url=` first: the field the model
 * has to echo back verbatim is the one it must not have to reconstruct. The floor-1 verdict
 * travels with the item ("matched on", tier) because "what got it here" is information the
 * chooser should be able to discount — a broad-tier match is the industry net, not a
 * personal one.
 */
function candidateBlock(candidates: ChooserCandidate[]): string {
  return candidates
    .map((c, n) => {
      const rows = [
        `${n + 1}. itemId=${c.itemId}`,
        `   title: ${c.title}`,
        c.publisher ? `   published by: ${c.publisher}` : "",
        c.publishedAt ? `   published: ${c.publishedAt}` : "",
        c.kind ? `   kind: ${c.kind}` : "",
        typeof c.stature === "number" && Number.isFinite(c.stature) ? `   stature: ${c.stature}` : "",
        joinList(c.matched) ? `   matched on (${c.tier || "unknown tier"}): ${joinList(c.matched)}` : "",
        c.summary ? `   summary: ${String(c.summary).slice(0, 600)}` : "",
      ];
      return rows.filter(Boolean).join("\n");
    })
    .join("\n");
}

export function chooserUserPrompt(person: ChooserPerson, candidates: ChooserCandidate[]): string {
  return `${personBlock(person)}\n\nITEMS (${candidates.length}), choose at most ${MAX_PICKS}:\n${candidateBlock(candidates)}`;
}

// ─── reading the answer ──────────────────────────────────────────────────────

const REASON_UNREADABLE = "תשובת הבורר לא נקראה (JSON חסר או חתוך) — תקלה, לא שיקול דעת";
const REASON_NO_CANDIDATES = "לא נשארה אף כתבה אחרי הסינון בקוד — הבורר לא הופעל";
const REASON_SILENT = "הבורר לא בחר כלום ולא נימק";

function fault(noneReason: string): ChooserResult {
  return { picks: [], noneReason, outcome: "parse_failed" };
}

/**
 * PURE. A response we cannot read yields NO picks and a reason — never a throw, and never
 * a pick we invented on the model's behalf.
 *
 * Hallucinated ids are DROPPED, exactly as `parseTriageResponse` drops an invented url and
 * `industryTagsFrom` drops an off-list tag. Not snapped onto the nearest candidate: a
 * coerced pick puts an article in front of a real person on a judgement no model ever made,
 * and it is invisible in the decision trail afterwards. The failure mode is not
 * hypothetical — the model inventing rows is what those two functions were written for.
 *
 * A pick with an empty `why` is dropped too. `why` is what the reviewer reads on the
 * approval screen and what the draft is built from; a pick with no reason is not a
 * judgement, it is a row.
 */
export function parseChooserResponse(text: string, validIds: Set<string>): ChooserResult {
  const parsed = parseJsonLoose<unknown>(text);
  const obj =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!obj) return fault(REASON_UNREADABLE);

  const rows = Array.isArray(obj.picks) ? obj.picks : null;
  const declaredNone = typeof obj.noneReason === "string" ? obj.noneReason.trim() : "";
  // `picks` present but not an array is a schema failure, not a "none" — unless the model
  // also stated a reason, in which case the reason is the answer.
  if (rows === null && !declaredNone) return fault(REASON_UNREADABLE);

  const picks: ChooserPick[] = [];
  const seen = new Set<string>();
  const invented: string[] = [];
  let malformedRows = 0;

  for (const row of rows ?? []) {
    const o = (row ?? {}) as Record<string, unknown>;
    const itemId = typeof o.itemId === "string" ? o.itemId.trim() : "";
    const why = typeof o.why === "string" ? o.why.trim() : "";
    if (!itemId) {
      malformedRows += 1;
      continue;
    }
    if (!validIds.has(itemId)) {
      invented.push(itemId);
      continue;
    }
    if (!why || seen.has(itemId)) {
      // A repeat is not a fault (the same item chosen twice is still one item); a missing
      // reason is, but both simply do not become a pick.
      if (!why) malformedRows += 1;
      continue;
    }
    seen.add(itemId);
    picks.push({ itemId, why });
    if (picks.length >= MAX_PICKS) break;
  }

  if (picks.length > 0) return { picks, outcome: "judged" };

  // Nothing survived. Which kind of nothing decides whether this is evidence or a bug.
  if (invented.length > 0) {
    return fault(
      `הבורר החזיר מזהים שלא היו ברשימה (${invented.slice(0, 3).join(", ")}) — תקלה, לא שיקול דעת`
    );
  }
  if (malformedRows > 0) return fault(REASON_UNREADABLE);
  return { picks: [], noneReason: declaredNone || REASON_SILENT, outcome: "none" };
}

/**
 * One Haiku call for one person, over every candidate that cleared the floors.
 *
 * No candidates means NO CALL. Zero items is the commonest shape of a quiet week and it
 * needs no model to summarise it; a call there would be eight paid requests per scan
 * asking a question whose answer is already known.
 *
 * A failed HTTP call is an `unavailable` outcome, never a throw and never a pick — the
 * veto's discipline, for the same reason: one unreachable model must not end a run whose
 * remaining people are fine. The kill-switch and the daily-budget block DO still throw
 * from inside `openrouterChat`; those are meant to stop the run, and Inngest treats them
 * as non-retriable.
 */
export async function chooseForPerson(
  person: ChooserPerson,
  candidates: ChooserCandidate[]
): Promise<ChooserResult> {
  const list = (Array.isArray(candidates) ? candidates : []).filter(
    (c) => c && typeof c.itemId === "string" && c.itemId.trim() !== ""
  );
  if (list.length === 0) {
    return { picks: [], noneReason: REASON_NO_CANDIDATES, outcome: "none" };
  }

  const res = await openrouterChat(
    OR_FEATURE.chooser,
    {
      model: chooserModel(),
      messages: [
        { role: "system", content: CHOOSER_SYSTEM },
        { role: "user", content: chooserUserPrompt(person, list) },
      ],
      // Zero, for the reason the veto is zero: this is a gate, and the same person against
      // the same week's items flipping between runs makes "is the bar right?" unanswerable.
      temperature: 0,
      max_tokens: chooserMaxTokens(list.length),
      response_format: { type: "json_object" },
    },
    { timeoutMs: CHOOSER_TIMEOUT_MS }
  );

  if (!res.ok) {
    return {
      picks: [],
      noneReason: `הבורר לא זמין (HTTP ${res.status}) — תקלה, לא שיקול דעת`,
      outcome: "unavailable",
    };
  }

  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  if (res.data.choices?.[0]?.finish_reason === "length") {
    // Visible, because bug (a) is silent otherwise: a truncated body still parses to
    // whatever whole picks it managed, and a thin answer looks like a strict chooser.
    console.error(
      `[radar] chooser TRUNCATED for ${person.fullName} over ${list.length} candidates — raise chooserMaxTokens`
    );
  }
  return parseChooserResponse(text, new Set(list.map((c) => c.itemId)));
}
