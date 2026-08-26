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

/**
 * Below this, a path segment is a tracking id or a short slug, not an encoded target —
 * decoding it would either fail harmlessly or, worse, decode to noise that happens to
 * contain "http". 16 comfortably excludes real segments like "articles" or "goto" while
 * including any base64url worth trying.
 */
const MIN_ENCODED_SEGMENT_LEN = 16;

/**
 * Google News RSS links (`news.google.com/rss/articles/<token>`) and some redirect
 * wrappers put the target inside a base64url PATH segment instead of a query param —
 * the query-param unwrap above finds nothing there. Tried only once the query-param
 * unwrap has already come up empty, and only on segments long enough that a short
 * tracking id can't false-positive.
 */
function decodePathSegmentTarget(u: URL): string | null {
  const segments = u.pathname.split("/").filter((s) => s.length > MIN_ENCODED_SEGMENT_LEN);
  for (const seg of segments) {
    const target = decodeBase64UrlSegment(seg);
    if (target) return target;
  }
  return null;
}

/** One path segment, decoded and scanned for an embedded URL — or null if it isn't one. */
function decodeBase64UrlSegment(segment: string): string | null {
  try {
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    // latin1, not utf8: the surrounding bytes are often binary (protobuf), and utf8
    // decoding would mangle them into replacement characters that could swallow the
    // ASCII URL sitting inside. latin1 is a lossless byte<->char mapping, so the URL's
    // own ASCII bytes survive untouched regardless of what is around them.
    const decoded = Buffer.from(padded, "base64").toString("latin1");
    const match = decoded.match(/https?:\/\/[!-~]+/i);
    if (!match) return null;
    const host = new URL(match[0]).hostname;
    if (SEARCH_ENGINE_HOST.test(host)) return null; // decoded into another wrapper — not a real target
    return match[0];
  } catch {
    return null;
  }
}

export function canonicalizeSourceUrl(raw: string): string {
  let url = (raw ?? "").trim();

  // Unwrap only on search-engine hosts. First try a query param that spells the target
  // out; a publisher's own URL-shaped params (share targets etc.) are part of the
  // address and are never touched because this branch only runs on a search-engine
  // host. If that finds nothing, try a base64url-encoded path segment. If neither
  // decodes, return the URL unchanged — today's behaviour — so the existing host
  // checks still catch it rather than forwarding a wrapper we could not resolve.
  for (let hop = 0; hop < MAX_UNWRAP_HOPS; hop += 1) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return url;
    }
    if (!SEARCH_ENGINE_HOST.test(u.hostname)) break;
    const target = [...u.searchParams.values()].find((v) => /^https?:\/\//i.test(v.trim()));
    if (target) {
      url = target.trim();
      continue;
    }
    const pathTarget = decodePathSegmentTarget(u);
    if (!pathTarget) break; // opaque — nothing to unwrap; the caller's host check catches it
    url = pathTarget;
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
