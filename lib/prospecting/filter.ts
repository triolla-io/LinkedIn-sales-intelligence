export type ScrapedCard = {
  urn: string;
  profileUrl: string;
  name: string;
  headline: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: string | null; // "1st" | "2nd" | "3rd" | "3rd+" | null
};

/**
 * Strip LinkedIn badge artifacts that ride along with a profile name in search-result cards.
 * The common offender is a "+N" shared-connection/overflow badge rendered inline with the name
 * (e.g. "+1 Yuval Bar Or"). Human names never contain a "+<digits>" token, so removing them
 * everywhere is safe. This is the server-side backstop for the extension's own scrape-time strip,
 * protecting against already-installed extension builds that still emit "+N" names.
 */
export function cleanScrapedName(name: string): string {
  return name.replace(/\+\d+/g, " ").replace(/\s+/g, " ").trim();
}

export type DecisionCtx = {
  existingContactUrns: Set<string>;
  existingRequestUrns: Set<string>;
};

export type Decision =
  | { action: "insert" }
  | { action: "skip"; skipReason: "already_contact" | "already_pending" | "not_2nd" | "not_israel" };

const ISRAEL_MATCHERS = ["israel", "ישראל"];

function isInIsrael(location: string | null): boolean {
  if (!location) return false;
  const lc = location.toLowerCase();
  return ISRAEL_MATCHERS.some((m) => lc.includes(m));
}

/** Order matters: dedup first (cheapest signal of intent), then the LinkedIn filters. */
export function decideCandidate(card: ScrapedCard, ctx: DecisionCtx): Decision {
  if (ctx.existingContactUrns.has(card.urn)) return { action: "skip", skipReason: "already_contact" };
  if (ctx.existingRequestUrns.has(card.urn)) return { action: "skip", skipReason: "already_pending" };
  if (card.degree !== "2nd") return { action: "skip", skipReason: "not_2nd" };
  if (!isInIsrael(card.location)) return { action: "skip", skipReason: "not_israel" };
  return { action: "insert" };
}
