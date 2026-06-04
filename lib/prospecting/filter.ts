export type ScrapedCard = {
  urn: string;
  profileUrl: string;
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: string | null; // "1st" | "2nd" | "3rd" | "3rd+" | null
};

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
