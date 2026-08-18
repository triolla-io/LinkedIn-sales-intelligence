/**
 * Page-context CONNECT routines (run inside the content script).
 *
 * Everything clicks via `element.click()` rather than coordinates: it dispatches straight
 * to the element regardless of layout, scroll, or occlusion — the fix for the old
 * no_connect / already_or_blocked failures caused by a 0×0 background layout.
 */

/** Every button/link/role=button in the document, piercing open shadow roots. */
function allActionables(root: ParentNode = document): HTMLElement[] {
  const out: HTMLElement[] = Array.from(
    root.querySelectorAll('button, a, [role="button"]'),
  ) as HTMLElement[];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) out.push(...allActionables(shadow));
  }
  return out;
}

/** True when `el` sits in a "People also viewed" / PYMK sidebar — those Connect buttons
 * belong to OTHER members. Walks through shadow hosts as well as parents. */
function inSidebar(el: HTMLElement): boolean {
  let p: HTMLElement | null = el;
  while (p) {
    if (p.tagName === "ASIDE") return true;
    const cls = typeof p.className === "string" ? p.className : "";
    if (/similar|browsemap|pymk|discovery/i.test(cls)) return true;
    const root = p.getRootNode?.();
    p = p.parentElement ?? ((root as ShadowRoot | undefined)?.host as HTMLElement | null) ?? null;
  }
  return false;
}

/**
 * Find AND click the Connect button for the profile identified by `slug`.
 *
 * Prefers the slug-scoped custom-invite link (unambiguously this person), then the main
 * card, and only then any remaining candidate.
 */
export function clickConnect(slug: string): boolean {
  const isConnect = (el: HTMLElement): boolean => {
    const t = (el.textContent ?? "").trim();
    const a = el.getAttribute("aria-label") ?? "";
    const href = (el.getAttribute("href") ?? "").toLowerCase();
    if (href.includes("custom-invite")) return !(slug && !href.includes(`vanityname=${slug}`));
    if (/invite\b.*\bto connect/i.test(a) || /^connect$/i.test(a)) return true;
    if (/^(connect|התחבר)$/i.test(t)) return true;
    return false;
  };

  const cands = allActionables().filter(isConnect);
  const slugMatch = cands.find((el) =>
    (el.getAttribute("href") ?? "").toLowerCase().includes(`vanityname=${slug}`),
  );
  const mainCard = cands.find((el) => !inSidebar(el));
  const target = slugMatch ?? mainCard ?? cands[0];
  if (!target) return false;
  target.click();
  return true;
}

/** Open the profile's "More" menu — Connect is sometimes tucked inside it. */
export function clickMore(): boolean {
  const more = allActionables().find(
    (el) =>
      /^more$/i.test((el.textContent ?? "").trim()) ||
      /^more actions$/i.test(el.getAttribute("aria-label") ?? ""),
  );
  if (!more) return false;
  more.click();
  return true;
}

const SEND_PATTERNS = [/^send\b/i, /send without/i, /^שלח/, /שלח ללא/];
const SKIP_PATTERN = /cancel|בטל|add a note|הוסף הערה|dismiss|got it|close|סגור/i;

/**
 * Click Send in the invite dialog ("Add a note to your invitation?").
 *
 * Matches Send / Send invitation / Send now / Send without a note (+ Hebrew), and falls
 * back to the dialog's primary action button — but only when a dialog was actually found,
 * so we never click a stray primary button elsewhere on the page.
 */
export function clickInviteSend(): boolean {
  const dialog = findDialog();
  const scope = dialog ?? document;
  let found: HTMLElement | null = null;
  let primary: HTMLElement | null = null;

  for (const el of allActionables(scope)) {
    const t = (el.textContent ?? "").trim();
    const a = el.getAttribute("aria-label") ?? "";
    if (SEND_PATTERNS.some((p) => p.test(t) || p.test(a))) {
      found = el;
      break;
    }
    const cls = typeof el.className === "string" ? el.className : "";
    if (!primary && /artdeco-button--primary/.test(cls) && !SKIP_PATTERN.test(`${t} ${a}`)) {
      primary = el;
    }
  }

  const target = found ?? (dialog ? primary : null);
  if (!target) return false;
  target.click();
  return true;
}

function findDialog(root: ParentNode = document): HTMLElement | null {
  const direct = root.querySelector<HTMLElement>('[role="dialog"], .artdeco-modal');
  if (direct) return direct;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) {
      const nested = findDialog(shadow);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * A creator / open-profile whose primary action is "Follow" and which exposes NO Connect
 * action at all. You cannot send a connection request to these, so the caller treats it as
 * an intentional SKIP rather than a failure.
 */
export function isFollowOnly(): boolean {
  const actionables = allActionables();
  const hasFollow = actionables.some(
    (el) =>
      /^follow$/i.test((el.textContent ?? "").trim()) ||
      /^follow\b/i.test(el.getAttribute("aria-label") ?? ""),
  );
  const hasConnect = actionables.some(
    (el) =>
      /^connect$/i.test((el.textContent ?? "").trim()) ||
      /\bto connect$/i.test(el.getAttribute("aria-label") ?? ""),
  );
  return hasFollow && !hasConnect;
}
