import { sendMessage } from "./lib/linkedin/send";
import { checkForReply } from "./lib/linkedin/inbox";

type Message =
  | { kind: "SEND"; payload: { text: string } }
  | { kind: "CHECK_REPLY"; payload: { sinceIso: string } };

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.kind === "SEND") {
        const result = await sendMessage(msg.payload.text);
        sendResponse({ ok: true, result });
      } else if (msg.kind === "CHECK_REPLY") {
        const result = await checkForReply(msg.payload.sinceIso);
        sendResponse({ ok: true, result });
      } else {
        sendResponse({ ok: false, errorCode: "unknown_kind", errorMessage: String((msg as { kind: unknown }).kind) });
      }
    } catch (err) {
      const e = err as Error & { code?: string };
      sendResponse({ ok: false, errorCode: e.code ?? "unknown", errorMessage: e.message });
    }
  })();
  return true; // keep channel open for async response
});
