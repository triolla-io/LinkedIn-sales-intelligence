/**
 * In-page profile-state classifier. Runs via chrome.debugger Runtime.evaluate, so it is a string
 * IIFE (like SCRAPE_FN_SOURCE in background.ts) — text/aria based only, no geometry. Pierces shadow
 * roots because LinkedIn renders profile actions inside the "interop-outlet" shadow DOM.
 * Returns "pending" | "connected" | "connectable".
 */
export const PROFILE_STATE_FN_SOURCE = `(() => {
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('button,[role="button"],a,span')) {
      const t = (el.textContent || '').trim();
      const a = el.getAttribute && el.getAttribute('aria-label') || '';
      all.push((t + ' ' + a).toLowerCase());
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  const text = all.join(' || ');
  if (/pending|invitation sent|withdraw invitation|ממתין/.test(text)) return 'pending';
  if (/remove (your )?connection|הסר חיבור|הסרת חיבור/.test(text)) return 'connected';
  return 'connectable';
})()`;
