// Reads the /recent-activity/all/ page. LinkedIn renders parts of the profile
// app inside open shadow roots (see the shadow-DOM epidemic notes) — every
// query here walks shadow roots, never just document.querySelectorAll.

const URN_RE = /urn:li:activity:(\d+)/;

function deepQueryAll(selector: string, root: ParentNode = document): Element[] {
  const found: Element[] = Array.from(root.querySelectorAll(selector));
  const hosts = root.querySelectorAll("*");
  for (const el of Array.from(hosts)) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) found.push(...deepQueryAll(selector, shadow));
  }
  return found;
}

const TEXT_SELECTORS = [
  ".update-components-text",
  ".feed-shared-inline-show-more-text",
  '[class*="update-components-text"]',
].join(", ");

const TIME_SELECTORS = [
  ".update-components-actor__sub-description",
  "time",
].join(", ");

export function readRecentPosts(limit: number): {
  posts: Array<{ urn: string; text: string; postedAgoText: string | null }>;
} {
  const containers = deepQueryAll(
    '[data-urn*="urn:li:activity"], [data-id*="urn:li:activity"]'
  );
  const seen = new Set<string>();
  const posts: Array<{ urn: string; text: string; postedAgoText: string | null }> = [];
  for (const el of containers) {
    const rawUrn = el.getAttribute("data-urn") ?? el.getAttribute("data-id") ?? "";
    const m = URN_RE.exec(rawUrn);
    if (!m) continue;
    const urn = `urn:li:activity:${m[1]}`;
    if (seen.has(urn)) continue;
    const text = el.querySelector(TEXT_SELECTORS)?.textContent?.trim() ?? "";
    if (!text) continue;
    const postedAgoText =
      el.querySelector(TIME_SELECTORS)?.textContent?.trim().replace(/\s+/g, " ") || null;
    seen.add(urn);
    posts.push({ urn, text, postedAgoText });
    if (posts.length >= limit) break;
  }
  return { posts };
}
