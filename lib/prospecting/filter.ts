import { resolveRoleFamily, familyHeadlineMatches } from "@/lib/roles/families";

export type ScrapedCard = {
  urn: string;
  profileUrl: string;
  name: string;
  headline: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: string | null; // "1st" | "2nd" | "3rd" | "3rd+" | null
  cardAction?: string | null; // search-card action button: "connect" | "follow" | "following" | "pending" | "message" | null (older extension builds omit it)
};

/**
 * Strip LinkedIn badge artifacts that ride along with a profile name in search-result cards.
 * The common offender is a "+N" shared-connection/overflow badge rendered inline with the name
 * (e.g. "+1 Yuval Bar Or"). Human names never contain a "+<digits>" token, so removing them
 * everywhere is safe. This is the server-side backstop for the extension's own scrape-time strip,
 * protecting against already-installed extension builds that still emit "+N" names.
 */
export function cleanScrapedName(name: string): string {
  return name
    .replace(/[‎‏‪-‮⁦-⁩]/g, "") // bidi/RTL control marks
    .split("•")[0] // drop the degree/badge that follows the bullet (locale-independent)
    .replace(/\+\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `headline` shows the person holds (a variant of) `searchTitle`. Known role
 * titles match against their whole family — every abbreviation, long form, VP/Head-of
 * variant, and Hebrew form (see lib/roles/families.ts) — so a "CFO" search also confirms
 * "VP Finance" or 'סמנכ"ל כספים'. Prevents LinkedIn's full-text `keywords=` search from
 * flooding the run with employees who merely mention an exec term (a PA "to the CEO", etc.),
 * while still catching everyone who actually leads that function. Unknown custom titles fall
 * back to a case-insensitive substring match of the (unquoted) search title. A null/empty
 * headline never matches.
 */
export function titleMatchesHeadline(searchTitle: string, headline: string | null): boolean {
  if (!headline) return false;
  const title = searchTitle.replace(/^"|"$/g, "").trim();
  if (!title) return false;
  const family = resolveRoleFamily(title);
  if (family) return familyHeadlineMatches(family, headline);
  return headline.toLowerCase().includes(title.toLowerCase());
}

export type DecisionCtx = {
  existingContactUrns: Set<string>;
  existingRequestUrns: Set<string>;
};

export type Decision =
  | { action: "insert" }
  | { action: "skip"; skipReason: "already_contact" | "already_pending" | "already_connected" | "pending_on_linkedin" };

/**
 * Decide whether a scraped search card should become a connection-request candidate.
 *
 * Degree and location are NOT used as rejection criteria. The LinkedIn search URL already
 * constrains results to 2nd-degree connections in the target geo (network=["S"] + geoUrn — see
 * buildSearchUrl), and that server-side facet is the reliable source of truth. The extension's
 * client-side card parsing, by contrast, is brittle against LinkedIn's frequently-changing DOM:
 * `degree` and `location` routinely come back null or garbled, so filtering on them rejected every
 * real candidate (observed in production: Tel Aviv / JFrog-Israel people skipped as not_israel,
 * clearly-2nd people skipped as not_2nd). We therefore trust the search facets and only act on the
 * one positive signal that still matters: a 1st-degree connection is already connected, so a
 * connection request would be pointless. Everything else is inserted; a non-connectable profile
 * that slips through is handled gracefully at send time (already_connected / no_connect).
 *
 * Order matters: dedup first (cheapest signal of intent), then the degree guard.
 */
export function decideCandidate(card: ScrapedCard, ctx: DecisionCtx): Decision {
  if (ctx.existingContactUrns.has(card.urn)) return { action: "skip", skipReason: "already_contact" };
  if (ctx.existingRequestUrns.has(card.urn)) return { action: "skip", skipReason: "already_pending" };
  if (card.degree === "1st") return { action: "skip", skipReason: "already_connected" };
  // The card's own action button saying "Pending" is a positive signal in the same spirit as the
  // 1st-degree guard: an invitation is already out, so attempting again is pointless.
  if (card.cardAction === "pending") return { action: "skip", skipReason: "pending_on_linkedin" };
  return { action: "insert" };
}

/**
 * Send priority for an inserted candidate. 0 = normal (card shows "Connect" or the action is
 * unknown), 1 = try last. "Follow"/"Following"/"Message" cards often lack a direct Connect button
 * (creator mode / open profiles) — many ARE still connectable via the profile's "More" menu, so we
 * don't skip them; we just attempt them only after the clean Connect pool is exhausted.
 */
export function computeSendPriority(card: ScrapedCard): number {
  return card.cardAction === "follow" || card.cardAction === "following" || card.cardAction === "message" ? 1 : 0;
}
