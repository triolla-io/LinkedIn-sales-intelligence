/**
 * Canonical form for a source URL that a HUMAN will receive.
 *
 * Different job from the dedupe keys (normalizeUrl, normalizeStoryUrl): those may be
 * lossy because nobody ever sees them. This one is stored and forwarded, so it changes
 * the URL only when the change is certain — unwrap a search-engine redirect whose
 * target is spelled out, drop tracking params, and otherwise leave the string alone.
 *
 * Born 2026-08-24: a draft went to a real person with google.com/goto?url=CAESvQEB…
 * as its link. The drafting rule "reproduce the link verbatim" worked exactly as
 * written — the URL entered the database already wrong, so the fix belongs at the
 * read stage, not the writing stage.
 */

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|igshid$)/i;

/**
 * Hosts that serve search results and redirects, never articles. A URL still on one of
 * these after canonicalization points at a redirect we could not unwrap (the target is
 * an opaque token, e.g. google.com/goto?url=CAES…) — callers must skip it rather than
 * forward it.
 */
const SEARCH_ENGINE_HOST =
  /(^|\.)(google\.[a-z]{2,3}(\.[a-z]{2})?|googleusercontent\.com|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/i;

export function isSearchEngineHost(hostOrUrl: string): boolean {
  let host = hostOrUrl;
  if (/^https?:\/\//i.test(hostOrUrl)) {
    try {
      host = new URL(hostOrUrl).hostname;
    } catch {
      return false;
    }
  }
  return SEARCH_ENGINE_HOST.test(host.trim().toLowerCase());
}

/** Bounded: a redirect chain deeper than this is not something we should trust anyway. */
const MAX_UNWRAP_HOPS = 3;

export function canonicalizeSourceUrl(raw: string): string {
  let url = (raw ?? "").trim();

  // Unwrap only on search-engine hosts, and only when a query param carries a full URL.
  // A publisher's own URL-shaped params (share targets etc.) are part of the address.
  for (let hop = 0; hop < MAX_UNWRAP_HOPS; hop += 1) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return url;
    }
    if (!SEARCH_ENGINE_HOST.test(u.hostname)) break;
    const target = [...u.searchParams.values()].find((v) => /^https?:\/\//i.test(v.trim()));
    if (!target) break; // opaque token — nothing to unwrap; the caller's host check catches it
    url = target.trim();
  }

  try {
    const u = new URL(url);
    let dropped = false;
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(k)) {
        u.searchParams.delete(k);
        dropped = true;
      }
    }
    // Re-serializing an unchanged URL is not harmless — it adds trailing slashes and
    // re-encodes characters, and this string must survive byte-for-byte comparison.
    if (!dropped) return url;
    const s = u.toString();
    return s.endsWith("?") ? s.slice(0, -1) : s;
  } catch {
    return url;
  }
}
