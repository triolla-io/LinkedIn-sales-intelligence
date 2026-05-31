type FindElementsMsg = { kind: "FIND_ELEMENTS"; selectors: string[] };
type Message = FindElementsMsg;

type ElementInfo = { found: boolean; x?: number; y?: number; width?: number; height?: number };

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.kind === "FIND_ELEMENTS") {
    const result: Record<string, ElementInfo> = {};
    for (const sel of msg.selectors) {
      const el = findVisible(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        result[sel] = {
          found: true,
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      } else {
        result[sel] = { found: false };
      }
    }
    sendResponse({ ok: true, result });
  } else {
    sendResponse({ ok: false, errorCode: "unknown_kind" });
  }
  return true;
});

function findVisible(sel: string): Element | null {
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}
