/**
 * In-page profile-state classifier. Runs inside the content script — text/aria based only,
 * no geometry. Pierces shadow roots because LinkedIn renders profile actions inside the
 * "interop-outlet" shadow DOM.
 */

export type ProfileState = "pending" | "connected" | "connectable";

export function detectProfileState(): ProfileState {
  const labels: string[] = [];
  const walk = (root: ParentNode) => {
    for (const node of Array.from(root.querySelectorAll('button,[role="button"],a,span'))) {
      const el = node as HTMLElement;
      const text = (el.textContent ?? "").trim();
      const aria = el.getAttribute?.("aria-label") ?? "";
      labels.push(`${text} ${aria}`.toLowerCase());
    }
    for (const node of Array.from(root.querySelectorAll("*"))) {
      const shadow = (node as HTMLElement).shadowRoot;
      if (shadow) walk(shadow);
    }
  };
  walk(document);

  const text = labels.join(" || ");
  if (/pending|invitation sent|withdraw invitation|ממתין/.test(text)) return "pending";
  if (/remove (your )?connection|הסר חיבור|הסרת חיבור/.test(text)) return "connected";
  return "connectable";
}
