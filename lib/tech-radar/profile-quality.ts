/**
 * Four numbers the 2026-08-26 rebuild could not produce, each answering a question its
 * report left open. Pure — no prisma, no LLM — so the preview and the writing rebuild read
 * the same code and cannot disagree about what they are measuring.
 *
 * They exist because that run reported success in every field it carried while three
 * separate things were wrong, and none of the three was countable:
 *
 *   1. Elinor Levinson Gafni came back with TWO axes, one of which was not even hers, and
 *      the run said "done". A thin profile has to declare itself thin.
 *   2. Stage (ד) — "what is done well somewhere else that this person could adopt" —
 *      produced zero axes for all four people, and nothing counted it. A prompt that fails
 *      to land looks exactly like a prompt that landed, unless the stages are tallied.
 *   3. Erez Rachmil and Pazit Garfinkel both work at Bank Hapoalim. If the brain hands them
 *      the same decision, it took the company and not the person — which is the whole
 *      defect the swap test was added to prevent.
 *   4. Refusing a cross-sector merge raises the axis count. It only raises the BILL if it
 *      raises the number of distinct query strings, because two axes asking the same string
 *      are one fetched query.
 */
import { AXIS_STAGES, type AxisProposal, type AxisStage } from "@/lib/tech-radar/person-profile";

/**
 * Below this, a person's model is too thin to be worth scanning for.
 *
 * Three is the floor the brain is asked for (3-5), so anything under it means the gate ate
 * more than it kept — and the run must say so next to the name rather than finishing quietly.
 */
export const MIN_AXES_PER_PERSON = 3;

export type ThinProfile = { name: string; axes: number; floor: number };

/** Everyone the gate left under the floor. Inclusive: exactly three is not thin. */
export function thinProfiles(people: { name: string; axes: unknown[] }[]): ThinProfile[] {
  return people
    .filter((p) => p.axes.length < MIN_AXES_PER_PERSON)
    .map((p) => ({ name: p.name, axes: p.axes.length, floor: MIN_AXES_PER_PERSON }));
}

/**
 * How many axes came from each staged question.
 *
 * Every stage is present even at zero, deliberately: `adopt: 0` across a whole cohort is
 * the signal that stage (ד) did not land, and an absent key reads as "not measured".
 */
export function stageDistribution(axes: Pick<AxisProposal, "stage">[]): Record<AxisStage, number> {
  const out = Object.fromEntries(AXIS_STAGES.map((s) => [s, 0])) as Record<AxisStage, number>;
  for (const a of axes) if (a.stage in out) out[a.stage] += 1;
  return out;
}

/** Compared on meaning: spacing and trailing punctuation are not a difference. */
function decisionKey(decision: string): string {
  return (decision ?? "").replace(/\s+/gu, " ").replace(/[.,;:!]+$/u, "").trim();
}

export type DecisionCollision = { employerId: string; decision: string; people: string[] };

/**
 * Two people at the SAME employer handed the same decision.
 *
 * Scoped to one employer on purpose. Two heads of retail banking at two different banks
 * both owning retail pricing is expected and correct; one company's decision handed to two
 * of its own executives is the union-instead-of-intersection failure, in its purest form.
 */
export function sameDecisionCollisions(
  people: { name: string; employerId: string; axes: Pick<AxisProposal, "personDecision">[] }[]
): DecisionCollision[] {
  const byKey = new Map<string, { employerId: string; decision: string; people: Set<string> }>();
  for (const p of people) {
    for (const a of p.axes) {
      const decision = decisionKey(a.personDecision ?? "");
      if (!decision) continue;
      const k = `${p.employerId}::${decision}`;
      const hit = byKey.get(k) ?? { employerId: p.employerId, decision, people: new Set<string>() };
      hit.people.add(p.name);
      byKey.set(k, hit);
    }
  }
  return [...byKey.values()]
    .filter((h) => h.people.size > 1)
    .map((h) => ({ employerId: h.employerId, decision: h.decision, people: [...h.people] }));
}

/**
 * Distinct query strings across a set of axes — the number that gets billed.
 *
 * Case-insensitive and whitespace-normalised, matching what the query pool itself collapses.
 */
export function uniqueQueryCount(axes: Pick<AxisProposal, "searchQueries">[]): number {
  const seen = new Set<string>();
  for (const a of axes) {
    for (const q of a.searchQueries ?? []) {
      const norm = (q ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
      if (norm) seen.add(norm);
    }
  }
  return seen.size;
}
