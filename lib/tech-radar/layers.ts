/**
 * Naming a layer of the person model, in code.
 *
 * The four-layer cake (1 industry, 2 company+customers, 3 what occupies them now, 4 the
 * person's own fields) has lived only as prose in the profile prompt and in the heads of
 * whoever last read it. That is exactly the shape of failure rationale-rules.ts exists to
 * prevent: a rule an LLM is trusted to apply consistently is not a rule until code checks
 * it. This module is that check for the layer cake — which layer an axis kind belongs to,
 * how deep a set of matches reaches, what stature an industry-only match needs to survive,
 * and when a layer-3 fact ("what occupies them now") has gone stale enough to stop
 * contributing queries.
 *
 * Pure. No prisma, no LLM.
 */

/**
 * The three axis kinds the schema can hold, and the layer each belongs to.
 *
 * Layer 2 (company + customers) has no axis kind of its own — it is never the deepest
 * thing an axis is ABOUT, only the fact an axis's evidence quotes on its way to layer 3 or
 * 4. So the map has three entries, not four; layer 2 still appears in `missingLayer`
 * because a gate rule can fail there even though no axis kind lives there.
 */
export type AxisKindName = "INDUSTRY" | "COMPANY_MONITOR" | "ROLE_COMPANY";

export const AXIS_KIND_LAYER: Record<AxisKindName, 1 | 3 | 4> = {
  INDUSTRY: 1,
  COMPANY_MONITOR: 3,
  ROLE_COMPANY: 4,
};

/**
 * The deepest layer reached by a set of matched axis kinds, or 0 for none.
 *
 * 0 is deliberately not reused as "layer 1" — an item matched by nothing and an item
 * matched only by the shared industry net are different states, and `passesLayerFloor`
 * treats them differently (0 never reaches the floor check at all; the caller filters it
 * out before matches even exist).
 */
export function deepestLayer(kinds: AxisKindName[]): 0 | 1 | 3 | 4 {
  let deepest: 0 | 1 | 3 | 4 = 0;
  for (const kind of kinds) {
    const layer = AXIS_KIND_LAYER[kind];
    if (layer > deepest) deepest = layer;
  }
  return deepest;
}

/**
 * Below this stature, an item matched ONLY by the shared industry-wide axis (layer 1) is
 * too generic to draft on — every C-level at every company in the industry would match the
 * same item. A match that also reaches layer 3 or 4 has already crossed something specific
 * to this person or their employer, so the floor does not apply to it.
 */
export const INDUSTRY_ONLY_STATURE_FLOOR = 0.8;

export function passesLayerFloor(deepest: number, stature: number): boolean {
  if (deepest === 1) return stature >= INDUSTRY_ONLY_STATURE_FLOOR;
  return true;
}

/**
 * Per item, the deepest layer wins — an item matched by both an INDUSTRY and a
 * ROLE_COMPANY axis is counted once, at layer 4, not once per layer. Mirrors
 * `passesLayerFloor`'s notion of "how deep did this item actually reach", so the two stay
 * consistent when a scan report explains what survived and why.
 */
export function articlesByLayer(
  rows: { itemId: string; kind: AxisKindName }[]
): { layer1: number; layer3: number; layer4: number } {
  const kindsByItem = new Map<string, AxisKindName[]>();
  for (const row of rows) {
    const existing = kindsByItem.get(row.itemId);
    if (existing) existing.push(row.kind);
    else kindsByItem.set(row.itemId, [row.kind]);
  }
  const counts = { layer1: 0, layer3: 0, layer4: 0 };
  for (const kinds of kindsByItem.values()) {
    const deepest = deepestLayer(kinds);
    if (deepest === 1) counts.layer1 += 1;
    else if (deepest === 3) counts.layer3 += 1;
    else if (deepest === 4) counts.layer4 += 1;
  }
  return counts;
}

/**
 * How long a layer-3 fact ("what occupies them now") keeps contributing queries.
 *
 * Layer 3 is deliberately the most perishable layer — it exists to capture something
 * timely ("a new CTO just started", "they announced a core migration"), and a query built
 * from a stale move is asking about news that is no longer news. 45 days is roughly the
 * cadence of a quarterly scan-and-a-half: long enough that a fact does not vanish before
 * the next tick has a chance to refresh it, short enough that "what occupies them now"
 * does not quietly mean "what occupied them last spring".
 */
export const LAYER3_QUERY_TTL_DAYS = 45;

const DAY_MS = 86_400_000;

/**
 * True only when the evidence names a layer-3 fact AND that fact's date parses AND the
 * fact is older than the TTL. Every other shape — layer 2 evidence, missing/malformed
 * `layerEvidence`, an unparseable `dateIso`, evidence that is not even an object — returns
 * false, not true: a bug in the JSON must never silently drop an axis from the pool, only
 * an actually-expired date may.
 */
export function layer3Expired(evidence: unknown, now: Date): boolean {
  if (typeof evidence !== "object" || evidence === null) return false;
  const layerEvidence = (evidence as { layerEvidence?: unknown }).layerEvidence;
  if (typeof layerEvidence !== "object" || layerEvidence === null) return false;
  const { layer, dateIso } = layerEvidence as { layer?: unknown; dateIso?: unknown };
  if (layer !== 3) return false;
  if (typeof dateIso !== "string" || !dateIso) return false;
  const ms = Date.parse(dateIso);
  if (Number.isNaN(ms)) return false;
  return now.getTime() - ms > LAYER3_QUERY_TTL_DAYS * DAY_MS;
}

/**
 * Which layer a gate rejection rule is missing, so the gate can name it in its report
 * (`axis_no_person_side [קומה 4 חסרה]: ...`) instead of leaving the reader to remember
 * which rule lives where.
 *
 * The mapping is by FAILURE SHAPE, not by rule name resemblance: every rule here fails
 * because one layer's evidence was never supplied, and the layer named is the one that
 * evidence would have belonged to.
 *   no_person_side / title_pattern / judged_generic — the rule is about the person's own
 *     field (layer 4): no crossing happened, the crossing was just a title, or the LLM
 *     judge called it generic. All three are "layer 4 never actually landed".
 *   no_company_side / unknown_competitor — the rule is about the company+customers fact
 *     (layer 2): no company side was declared, or the one named was not a real competitor.
 *   layer3_undated — the rule is about a layer-3 fact with no usable date (Task 11).
 * Anything else (contradicts_reasoning and future rules) is not about a missing layer at
 * all, so it gets no suffix.
 */
export function missingLayer(rule: string): 2 | 3 | 4 | null {
  switch (rule) {
    case "no_person_side":
    case "title_pattern":
    case "judged_generic":
      return 4;
    case "no_company_side":
    case "unknown_competitor":
      return 2;
    case "layer3_undated":
      return 3;
    default:
      return null;
  }
}
