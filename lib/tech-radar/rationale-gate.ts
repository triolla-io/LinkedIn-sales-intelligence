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
  unknownNames,
  contradictsReasoning,
  competitorGazetteer,
} from "@/lib/tech-radar/rationale-rules";

const MODEL = process.env.TECH_RADAR_MODEL ?? "anthropic/claude-haiku-4.5";

export const RATIONALE_GATE_SYSTEM = `You judge the RATIONALE attached to each proposed interest of one professional.

A rationale passes when it points at something THIS person holds: a decision they sign (מחזיק את החלטת X), a project they run, an asset they carry, or a named competitor pressing on customers they own.

A rationale fails as GENERIC when it merely describes a domain, an industry, or restates the job title — "כי הוא בבנקאות", "כתפקידו אחראי על טכנולוגיה". The test: could this sentence be written, unchanged, about a different person with the same title at another company? If yes, it is generic.

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
   * How many axes the DETERMINISTIC rules killed, by rule. `title_pattern` is the one to
   * watch: it measures whether the brain is obeying the prompt's prohibition, and a
   * number that stays high means the prompt is not landing — not that the rule is wrong.
   */
  deterministic: Record<string, number>;
};

/** The employer facts the deterministic rules need. */
export type GateContext = {
  /** From the employer research. Both scripts per competitor. */
  namedCompetitors?: string[];
  /** The brain's own staged answers, for the self-contradiction check. */
  reasoning?: string;
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
  const deterministic: Record<string, number> = {};
  const hardRejected: { label: string; rationale: string; reason: string }[] = [];
  const survivors: AxisProposal[] = [];

  for (const p of proposals) {
    let reason: string | null = null;

    if (opensWithTitle(p.rationale)) {
      reason = "title_pattern";
    } else if (gazetteer.length > 0) {
      const unknown = unknownNames(p.rationale, gazetteer);
      if (unknown.length > 0) reason = `unknown_competitor:${unknown.join(",")}`;
    }
    if (!reason && ctx.reasoning && contradictsReasoning(p, ctx.reasoning)) {
      reason = "contradicts_reasoning";
    }

    if (reason) {
      const key = reason.split(":")[0];
      deterministic[key] = (deterministic[key] ?? 0) + 1;
      hardRejected.push({ label: p.label, rationale: p.rationale, reason });
    } else {
      survivors.push(p);
    }
  }

  if (survivors.length === 0) {
    return { kept: [], rejected: hardRejected, judged: true, deterministic };
  }
  proposals = survivors;

  const user = [
    `Person's role lens: ${roleLens}`,
    ...proposals.map((p, i) => `${i}. [${p.label}] ${p.rationale}`),
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
