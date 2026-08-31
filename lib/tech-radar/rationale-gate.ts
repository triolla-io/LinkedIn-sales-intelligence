/**
 * The veto's person-specificity bar, moved to profile build time.
 *
 * The veto judges (person × item) and rejects "not_person_specific" — but by then the
 * generic axis has already spent a week of searches and axis-fit judgements. The same
 * bar applied to the RATIONALE at build time kills the axis before it costs anything:
 * "כי הוא בבנקאות" describes a domain and dies here; "כי הוא מחזיק את החלטת X" points
 * at a staged answer and lives.
 *
 * One Haiku call per person for the whole batch (~$0.007), not one per axis.
 * Fail-open: a dead judge must not brick onboarding — the veto still guards the exit.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";
import type { AxisProposal } from "@/lib/tech-radar/person-profile";
import {
  opensWithTitle,
  unverifiedRivals,
  contradictsReasoning,
  competitorGazetteer,
  declaresPersonSide,
  declaresCompanySide,
  dateIsoNotInMoves,
  duplicateDecisionIndexes,
} from "@/lib/tech-radar/rationale-rules";

const MODEL = process.env.TECH_RADAR_MODEL ?? "anthropic/claude-haiku-4.5";

/** True only for a non-empty string that `Date.parse` can actually read. */
function hasUsableDate(dateIso: string | undefined): boolean {
  return typeof dateIso === "string" && dateIso.length > 0 && !Number.isNaN(Date.parse(dateIso));
}

export const RATIONALE_GATE_SYSTEM = `You judge the RATIONALE attached to each proposed interest of one professional. Each one arrives with the two sides it claims to cross: the DECISION this person holds, and the FACT about their company that decision met.

A rationale passes when it points at something THIS person holds: a decision they sign (מחזיק את החלטת X), a project they run, an asset they carry, or a named competitor pressing on customers they own.

THE SWAP TEST — run both swaps on every rationale:
- SWAP THE PERSON: keep the company, put a different executive from a different chair in it. Does the sentence still hold? If yes, it is the COMPANY'S subject rather than this person's.
- SWAP THE COMPANY: keep the title, move the person to a company in a different industry. Does the sentence still hold? If yes, it is the TITLE'S subject rather than an intersection.

A rationale is GENERIC only when it survives BOTH swaps — true of a different executive at this same company AND of the same title at a company in another industry. "כי הוא בבנקאות" and "כתפקידו אחראי על טכנולוגיה" survive both: they describe a domain, and everyone in the domain fits them.

A rationale that survives only ONE swap is NOT generic, and calling it generic is the mistake to avoid. An adopt-stage rationale — this person's own decision plus something done well in another market or another industry — typically breaks under the person swap and survives the company swap. Leave it: it is a real interest, and it is the material people actually forward.

Return strict JSON only: {"verdicts":[{"i":<index>,"generic":true|false}]} — one verdict per input index.`;

/**
 * Pure. Missing verdicts read as NOT generic: a judge that forgot an axis must not
 * silently kill it — the veto still guards the exit for anything that slips through.
 */
export function parseRationaleVerdicts(text: string, count: number): boolean[] {
  const parsed = parseJsonLoose<{ verdicts?: unknown }>(text);
  const rows = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
  const out = new Array<boolean>(count).fill(false);
  for (const row of rows) {
    const o = row as Record<string, unknown>;
    const i = typeof o.i === "number" ? o.i : Number.NaN;
    if (Number.isInteger(i) && i >= 0 && i < count) out[i] = o.generic === true;
  }
  return out;
}

export type GateResult = {
  kept: AxisProposal[];
  rejected: { label: string; rationale: string; reason: string }[];
  /** False when the judge call failed and everything was kept unjudged. */
  judged: boolean;
  /**
   * How many axes the DETERMINISTIC rules killed, by rule: `title_pattern`,
   * `unknown_competitor`, `no_person_side`, `no_company_side`, `contradicts_reasoning`,
   * `layer3_undated`, `layer3_fabricated_date`, `duplicate_person_decision`.
   *
   * `layer3_fabricated_date` staying above zero is the placeholder-date failure showing up
   * as a number instead of as axes that silently search for nothing after layer3Expired
   * ages out an invented "2024-01-01". `duplicate_person_decision` is the only counter that
   * measures the batch rather than an axis: it counts one signature that arrived wearing
   * several labels.
   *
   * `title_pattern` is the one to watch for prompt compliance: it measures whether the
   * brain is obeying the prompt's prohibition, and a number that stays high means the
   * prompt is not landing — not that the rule is wrong. The two side counters read the
   * same way for the crossing: `no_company_side` staying high means the brain is still
   * proposing unions, which is the 2026-08-26 failure showing up as a number instead of
   * as four generic axes on a CITO's screen.
   */
  deterministic: Record<string, number>;
};

/** The employer facts the deterministic rules need. */
export type GateContext = {
  /** From the employer research. Both scripts per competitor. */
  namedCompetitors?: string[];
  /**
   * From the employer research, and stored in ENGLISH ("B2C: Individual consumers and
   * retail customers") while the brain declares its companyFact in HEBREW. So this is
   * NOT the primary way the company side is recognised — a Hebrew segment lexicon in
   * rationale-rules.ts is — and it only lets a fact that quotes the research verbatim
   * count as what it plainly is.
   */
  customerSegments?: string[];
  /** The brain's own staged answers, for the self-contradiction check. */
  reasoning?: string;
  /**
   * The employer's own identity: its names, aliases and product names.
   *
   * Without it the rule has no way to tell "my own company" from "a company I invented".
   * Gil Tamir's axis was rejected for naming "Phoenix" — his own employer — and two of
   * Pazit Garfinkel's for naming "Poalim UP", Bank Hapoalim's own product.
   */
  employer?: { names: string[]; products: string[] };
  /**
   * The dated moves the employer research actually found, for the fabricated-date check.
   *
   * Every layer-3 axis in the pilot org carried `dateIso: "2024-01-01"` — invented to
   * satisfy the prompt — and layer3Expired then dropped all of them from the query pool.
   * Absent or empty, the check does NOT run: with no moves in hand the gate cannot tell a
   * fabricated date from a real one, and the same fail-open guards unknown_competitor
   * behind `gazetteer.length > 0`.
   */
  recentMoves?: { dateIso: string }[];
};

export async function gateRationales(
  roleLens: string,
  proposals: AxisProposal[],
  ctx: GateContext = {}
): Promise<GateResult> {
  if (proposals.length === 0) {
    return { kept: [], rejected: [], judged: true, deterministic: {} };
  }

  // ── Deterministic rules FIRST, so the judge never gets a say on them ──────
  const gazetteer = competitorGazetteer(ctx.namedCompetitors ?? []);
  // The research's OWN words cannot be a hallucination. A companyFact that quotes a
  // stored segment — "B2C: Individual consumers" — would otherwise be rejected for the
  // capitalised "Individual", which names no company at all; the same normalisation the
  // competitor gazetteer uses makes the quote recognisable.
  const allowedNames = [...gazetteer, ...competitorGazetteer(ctx.customerSegments ?? [])];
  const deterministic: Record<string, number> = {};
  const hardRejected: { label: string; rationale: string; reason: string }[] = [];
  const survivors: AxisProposal[] = [];

  for (const p of proposals) {
    let reason: string | null = null;

    if (opensWithTitle(p.rationale)) {
      reason = "title_pattern";
    } else if (gazetteer.length > 0) {
      // The companyFact is scanned alongside the rationale, because it is now where the
      // rival names live — and an invented rival in a message to a board member cannot
      // be taken back. Checked BEFORE the two side rules so a hallucination is reported
      // as a hallucination rather than as an unrecognised company side.
      //
      // Role-aware, not a flat allow-list: verification applies ONLY to a name CLAIMED AS
      // A RIVAL. The employer's own brands are not a competitive claim, and an adopt axis
      // names someone to learn from by definition — asking whether they are on the
      // competitor list is the wrong question and can only ever reject a correct axis.
      const unknown = unverifiedRivals(`${p.rationale} ${p.companyFact}`, {
        employer: ctx.employer ?? { names: [], products: [] },
        stage: p.stage,
        gazetteer: allowedNames,
      });
      if (unknown.length > 0) reason = `unknown_competitor:${unknown.join(",")}`;
    }
    // Both sides of the crossing, declared. The 2026-08-26 run produced axes that were
    // unions — a CITO got his employer's four technical axes — and prose could not be
    // asked which half was the person and which was the company. Now it is asked, in
    // code, before the judge gets a say on anything.
    if (!reason && !declaresPersonSide(p.personDecision)) {
      reason = "no_person_side";
    }
    if (!reason && !declaresCompanySide(p.companyFact, gazetteer, ctx.customerSegments ?? [])) {
      reason = "no_company_side";
    }
    if (!reason && ctx.reasoning && contradictsReasoning(p, ctx.reasoning)) {
      reason = "contradicts_reasoning";
    }
    // Layer 3 ("what occupies them now") is only as good as its date — an undated move
    // cannot be told apart from one that occupied the company last spring, and
    // layer3Expired (layers.ts) can only age out a date it can parse. The prompt REQUIRES
    // dateIso on a layer-3 quote, but the parser deliberately keeps an axis whose date
    // failed to parse (person-profile.ts) rather than silently dropping it — so the gate
    // is where an undated layer-3 fact actually dies, named, instead of vanishing into an
    // anonymous "no usable axis" count.
    if (!reason && p.layerEvidence?.layer === 3 && !hasUsableDate(p.layerEvidence.dateIso)) {
      reason = "layer3_undated";
    }
    // A date that PARSES but that the research never reported is worse than a missing one:
    // layer3_undated dies loudly here, while an invented "2024-01-01" — which is what every
    // layer-3 axis in the pilot org carried — passes every check and is then dropped from
    // the query pool by layer3Expired (layers.ts, TTL 45 days) without a word. Five of the
    // group's axes searched for nothing that way, including one person's only two.
    //
    // Runs only when the caller supplied moves, for the same reason unknown_competitor
    // sits behind `gazetteer.length > 0`: an unverifiable claim must not be a rejected one.
    if (
      !reason &&
      (ctx.recentMoves?.length ?? 0) > 0 &&
      p.layerEvidence?.layer === 3 &&
      dateIsoNotInMoves(p.layerEvidence.dateIso, ctx.recentMoves ?? [])
    ) {
      reason = "layer3_fabricated_date";
    }

    if (reason) {
      const key = reason.split(":")[0];
      deterministic[key] = (deterministic[key] ?? 0) + 1;
      hardRejected.push({ label: p.label, rationale: p.rationale, reason });
    } else {
      survivors.push(p);
    }
  }

  // One signature, one axis — the only rule here that judges the BATCH rather than an axis.
  // Pazit Garfinkel's five axes were one personDecision wearing five labels, each of them a
  // real ownership claim, so every per-axis rule and the judge itself passed all five. Run
  // LAST, over the survivors only: an axis already rejected for another reason must not
  // also be counted as the clone of a kept one, and the FIRST of each group is what stays.
  const dupes = new Set(duplicateDecisionIndexes(survivors.map((p) => p.personDecision)));
  if (dupes.size > 0) {
    for (const [i, p] of survivors.entries()) {
      if (!dupes.has(i)) continue;
      deterministic.duplicate_person_decision = (deterministic.duplicate_person_decision ?? 0) + 1;
      hardRejected.push({ label: p.label, rationale: p.rationale, reason: "duplicate_person_decision" });
    }
  }
  const deduped = survivors.filter((_, i) => !dupes.has(i));

  if (deduped.length === 0) {
    return { kept: [], rejected: hardRejected, judged: true, deterministic };
  }
  proposals = deduped;

  // The judge is shown both declared sides, not just the sentence: it cannot run the
  // person swap without knowing which decision the axis claims this person holds.
  const user = [
    `Person's role lens: ${roleLens}`,
    ...proposals.map(
      (p, i) =>
        `${i}. [${p.label}] stage=${p.stage} | person's decision: ${p.personDecision} | fact about the company: ${p.companyFact} | rationale: ${p.rationale}`
    ),
  ].join("\n");

  const res = await openrouterChat(
    OR_FEATURE.rationaleGate,
    {
      model: MODEL,
      messages: [
        { role: "system", content: RATIONALE_GATE_SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 20_000 }
  );
  if (!res.ok) return { kept: proposals, rejected: hardRejected, judged: false, deterministic };

  const generic = parseRationaleVerdicts(res.data.choices?.[0]?.message?.content ?? "", proposals.length);
  const kept = proposals.filter((_, i) => !generic[i]);
  const rejected = [
    ...hardRejected,
    ...proposals
      .filter((_, i) => generic[i])
      .map((p) => ({ label: p.label, rationale: p.rationale, reason: "judged_generic" })),
  ];

  // The parser guarantees exactly one agenda axis; if the gate killed it, promote the
  // first survivor rather than leaving the person with role axes only.
  if (kept.length > 0 && !kept.some((a) => a.agenda)) kept[0] = { ...kept[0], agenda: true };

  return { kept, rejected, judged: true, deterministic };
}
