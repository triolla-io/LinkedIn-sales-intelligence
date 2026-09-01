/**
 * One person's matching vocabulary, in three tiers.
 *
 * v2 made an axis's central product a set of SEARCH QUERIES, and the pilot measured what
 * that cost: five of the pilot org's layer-3 axes carried the invented date "2024-01-01",
 * the 45-day TTL dropped them from the query pool, and half the axes on screen searched
 * for nothing at all. v3 inverts it — a fixed set of sources is pulled, an item is tagged
 * into a closed taxonomy by triage, and a person is matched by TAG OVERLAP. The axis
 * machine stays exactly as it is; what changes is that an axis is now a tag rather than a
 * query writer.
 *
 * The tiers are the whole design, because they are what separates recall from noise:
 *   focused — this person's OWN subjects, plus anything a human attached by hand. One is
 *             enough to make an item a candidate.
 *   broad   — the shared industry net, subscribed by most of the cohort. Two of them AND
 *             real stature, which is INDUSTRY_ONLY_STATURE_FLOOR restated in tag terms.
 *   entities— the NAMED things they watch, matched in code rather than by an LLM. "One
 *             Zero" in a headline is news for whoever tracks One Zero and for nobody else.
 *
 * PURE, and it takes already-loaded rows: no prisma, no LLM, no network. The floors run
 * thousands of times a scan and must stay callable from a test without a database.
 */

/**
 * One PersonAxis link, flattened with the bits of its RadarAxis that decide the tier.
 *
 * The caller does the join and hands rows over, which is what keeps this file pure. `tag`
 * is the string this link CONTRIBUTES — the taxonomy tag for an industry axis, the
 * entity's canonical name for a PERSON_ENTITY one — resolved by the caller rather than
 * re-derived here from `key`, because the "industry:" prefix that `industryKey()` writes
 * is a storage detail and a tag layer that strips prefixes silently loses any axis whose
 * prefix changes.
 */
export type PersonTagLink = {
  /** PersonAxis.personProfileId. Filtered on — see the isolation rule below. */
  personProfileId: string;
  /** RadarAxis.kind, as a plain string: see BROAD_KINDS on why this is not the enum. */
  kind: string;
  /** PersonAxis.source. MANUAL is the one value that overrides the kind. */
  source: string;
  /** PersonAxis.mutedAt. Set = this person said "לא מעניין אותי", and it is respected. */
  mutedAt?: Date | string | null;
  /** The taxonomy tag, or — for a PERSON_ENTITY link — the entity's canonical name. */
  tag: string;
  /** PersonAxis.evidence. A PERSON_ENTITY link keeps its aliases here. Untyped Json. */
  evidence?: unknown;
};

/** Only the id is read. The tiers are decided entirely by the links. */
export type PersonTagOwner = { id: string };

export type PersonTagSet = {
  focused: string[];
  broad: string[];
  entities: { name: string; aliases: string[] }[];
};

/**
 * Axis kinds that constitute the SHARED industry net, and therefore the broad tier.
 *
 * Both spellings on purpose. The schema's kind is `INDUSTRY` today and the v3 spec calls
 * the tag-carrying version `INDUSTRY_TAG`; accepting both means a rename in the enum
 * cannot quietly demote a whole cohort's industry tags to the focused tier — which would
 * hand every C-level in Israeli banking every banking item, the exact failure the broad
 * floor exists to prevent. Plain strings rather than the Prisma enum for the same reason
 * `TechItem.kind` is a String: an enum member cannot be used in the migration that adds it.
 */
const BROAD_KINDS: ReadonlySet<string> = new Set(["INDUSTRY", "INDUSTRY_TAG"]);

/** The kind whose links are matched by name in code instead of by tag overlap. */
const ENTITY_KIND = "PERSON_ENTITY";

/** A human attaching a tag by hand. Never overwritten by a rebuild, never demoted. */
const MANUAL_SOURCE = "MANUAL";

/** Compares two tags the way a human would: same characters, any casing or padding. */
function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, " ");
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** `evidence.aliases`, defensively. A legacy row's evidence is null, or a bare string. */
function readAliases(evidence: unknown, name: string): string[] {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) return [];
  const raw = (evidence as { aliases?: unknown }).aliases;
  if (!Array.isArray(raw)) return [];
  const nameKey = tagKey(name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of raw) {
    const alias = str(a);
    if (!alias) continue;
    const key = tagKey(alias);
    // An alias that only restates the name is noise — the same rule readEntityTags
    // applies at parse time, applied again here because a MANUAL row never went through it.
    if (key === nameKey || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/**
 * This person's tags, in the three tiers the matching floors read.
 *
 * The rules, each with the failure it answers:
 *
 * ISOLATION — links whose `personProfileId` is not this person's are ignored rather than
 * trusted. Elinor Levinson Gafni (Bank Leumi) sat subscribed to "תחרות דיגיטלית מול הראל
 * ומגדל" with insurance queries in prod; a tag layer that read the ORG's links would hand
 * Pazit Garfinkel Elinor's rivals, which is that leak with a new mechanism. Filtering here
 * rather than trusting the query means a caller that widens its `where` cannot cause it.
 *
 * MUTING — a muted link contributes to NOTHING. `mutedAt` is the user's own downward
 * handle and MANUAL is the upward one; a mute that only lowered a weight would be a
 * preference the system overrules, which is the opposite of what it is.
 *
 * MANUAL beats kind — a hand-attached INDUSTRY tag lands in `focused`, not `broad`. As a
 * broad tag it would need a second broad tag AND stature 0.8 to survive the floors, so the
 * correction would not stick, and a correction that does not stick is not a correction.
 *
 * A PERSON_ENTITY link is ALSO an entity when its source is MANUAL, so a hand-added name
 * still matches by name in code — which is the only thing that makes a name tag work. That
 * puts a MANUAL entity in both `focused` and `entities`; the duplication only ever raises
 * the tier, and the name will not appear in the closed taxonomy, so it costs nothing.
 *
 * A tag that arrives both focused and broad is kept focused ONLY. Leaving the copy in
 * broad would let one subject count toward `minBroad` twice and clear a floor of two on
 * its own — a threshold that can be met by one tag is not a threshold.
 */
export function personTags(profile: PersonTagOwner, links: PersonTagLink[]): PersonTagSet {
  const focused: string[] = [];
  const focusedKeys = new Set<string>();
  const broadCandidates: string[] = [];
  const entities: { name: string; aliases: string[] }[] = [];
  const entityKeys = new Set<string>();

  for (const link of Array.isArray(links) ? links : []) {
    if (!link || link.personProfileId !== profile.id) continue;
    if (link.mutedAt != null) continue;
    const tag = str(link.tag);
    if (!tag) continue;

    if (link.kind === ENTITY_KIND) {
      const key = tagKey(tag);
      if (!entityKeys.has(key)) {
        entityKeys.add(key);
        entities.push({ name: tag, aliases: readAliases(link.evidence, tag) });
      }
    }

    const isBroad = BROAD_KINDS.has(link.kind) && link.source !== MANUAL_SOURCE;
    if (isBroad) {
      broadCandidates.push(tag);
      continue;
    }
    // Everything else is this person's own: a ROLE_COMPANY subject, a COMPANY_MONITOR,
    // a MANUAL attachment of any kind, and any future kind. Defaulting to focused is the
    // deliberate direction — a new kind that reaches nobody is invisible, while a new kind
    // that reaches one person too eagerly is visible on the approval screen.
    const key = tagKey(tag);
    if (focusedKeys.has(key)) continue;
    focusedKeys.add(key);
    focused.push(tag);
  }

  const broad: string[] = [];
  const broadKeys = new Set<string>();
  for (const tag of broadCandidates) {
    const key = tagKey(tag);
    if (focusedKeys.has(key) || broadKeys.has(key)) continue;
    broadKeys.add(key);
    broad.push(tag);
  }

  return { focused, broad, entities };
}
