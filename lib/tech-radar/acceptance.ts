/**
 * Did a run find anything worth sending, by the standard the pilot set on 2026-08-23?
 *
 * The run before it returned items that were on-topic and weightless — a Nature paper on
 * an injection polymer, a trade-journal piece on a pipe robot. Relevant, no gift. So a
 * run now has to clear two explicit bars, and when it does not, it says so.
 *
 * The rule that matters most: a shortfall is REPORTED, never filled with substitutes.
 * Padding a thin week with the best of a weak pool is how a radar becomes a newsletter.
 *
 * Pure.
 */
import { FLAGSHIP_KINDS, STATURE_FLOOR, type ItemKind } from "@/lib/tech-radar/types";

/** Israeli business press, where the best local gifts come from. */
const ISRAELI_HOSTS = [
  "globes.co.il",
  "calcalist.co.il",
  "themarker.com",
  "bizportal.co.il",
  "funder.co.il",
  "ice.co.il",
  "mako.co.il",
  "ynet.co.il",
  "maariv.co.il",
  "jpost.com",
  "timesofisrael.com",
];

export function isIsraeliSource(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Suffix match on a dot boundary, so "notglobes.co.il" does not count and
  // "www.globes.co.il" does.
  return ISRAELI_HOSTS.some((h) => host === h || host.endsWith("." + h)) || host.endsWith(".co.il");
}

export type AcceptanceInput = {
  kind: ItemKind;
  stature: number;
  url: string | null;
};

export type AcceptanceReport = {
  /** Items of flagship/regulatory/market-move weight. Target: 2. */
  weighty: number;
  /** Items from an Israeli source. Target: 1. */
  israeli: number;
  met: boolean;
  /** What to say when it was not met. Empty when it was. */
  shortfall: string;
};

export const MIN_WEIGHTY = 2;
export const MIN_ISRAELI = 1;

export function judgeAcceptance(items: AcceptanceInput[]): AcceptanceReport {
  // Weight AND kind: a flagship kind with low stature is the exact item that passed the
  // last run and should not have.
  const weighty = items.filter(
    (i) => i.stature >= STATURE_FLOOR && (FLAGSHIP_KINDS as readonly string[]).includes(i.kind)
  ).length;
  const israeli = items.filter((i) => isIsraeliSource(i.url)).length;

  const missing: string[] = [];
  if (weighty < MIN_WEIGHTY) {
    missing.push(`\u05e4\u05e8\u05d9\u05d8\u05d9\u05dd \u05d1\u05de\u05e9\u05e7\u05dc \u05d3\u05d5\u05d7-\u05d3\u05d2\u05dc/\u05e8\u05d2\u05d5\u05dc\u05e6\u05d9\u05d4/\u05de\u05d4\u05dc\u05da-\u05e9\u05d5\u05e7: ${weighty} \u05de\u05ea\u05d5\u05da ${MIN_WEIGHTY}`);
  }
  if (israeli < MIN_ISRAELI) {
    missing.push(`\u05e4\u05e8\u05d9\u05d8 \u05de\u05de\u05e7\u05d5\u05e8 \u05d9\u05e9\u05e8\u05d0\u05dc\u05d9: ${israeli} \u05de\u05ea\u05d5\u05da ${MIN_ISRAELI}`);
  }

  return {
    weighty,
    israeli,
    met: missing.length === 0,
    shortfall: missing.length === 0 ? "" : `\u05e0\u05e1\u05e8\u05e7 \u05d5\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0 \u2014 ${missing.join("; ")}`,
  };
}
