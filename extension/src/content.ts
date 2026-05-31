type FindElementsMsg = { kind: "FIND_ELEMENTS"; selectors: string[] };
type Message = FindElementsMsg;
type ElementInfo = { found: boolean; x?: number; y?: number; width?: number; height?: number };

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.kind === "FIND_ELEMENTS") {
    const result: Record<string, ElementInfo> = {};
    for (const sel of msg.selectors) {
      const info = findVisibleWithCoords(sel);
      result[sel] = info ?? { found: false };
    }
    sendResponse({ ok: true, result });
  } else {
    sendResponse({ ok: false, errorCode: "unknown_kind" });
  }
  return true;
});

function findVisibleWithCoords(sel: string): ElementInfo | null {
  // Check main document first
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: Math.round(r.width), height: Math.round(r.height) };
    }
  }

  // Check same-origin iframes (LinkedIn's chat overlay may render in one)
  for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
    try {
      const iDoc = (iframe as HTMLIFrameElement).contentDocument;
      if (!iDoc) continue;
      for (const el of Array.from(iDoc.querySelectorAll(sel))) {
        const er = el.getBoundingClientRect();
        if (er.width > 0 && er.height > 0) {
          const fr = iframe.getBoundingClientRect();
          return {
            found: true,
            x: Math.round(fr.left + er.left + er.width / 2),
            y: Math.round(fr.top + er.top + er.height / 2),
            width: Math.round(er.width),
            height: Math.round(er.height),
          };
        }
      }
    } catch { /* cross-origin iframe, skip */ }
  }

  return null;
}
