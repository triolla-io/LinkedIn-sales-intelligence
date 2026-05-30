import { SEL } from "./selectors";
import { humanType } from "../human/type";
import { humanPause } from "../human/timing";

export async function sendMessage(text: string): Promise<{ sentAt: string; conversationUrl: string }> {
  if (location.href.includes("/checkpoint/") || document.querySelector(SEL.checkpointMarker)) {
    throw withCode(new Error("LinkedIn checkpoint detected"), "checkpoint");
  }

  await humanPause(2000, 5000);

  const msgBtn = await waitFor(SEL.messageButton, 15_000);
  if (!msgBtn) throw withCode(new Error("Message button not found"), "not_messageable");
  (msgBtn as HTMLElement).click();

  const editor = await waitFor(SEL.composeEditor, 10_000);
  if (!editor) throw withCode(new Error("Compose editor not found"), "selector_missing");

  await humanType(editor as HTMLElement, text);
  await humanPause(1000, 3000);

  const sendBtn = document.querySelector(SEL.composeSendButton) as HTMLButtonElement | null;
  if (!sendBtn) throw withCode(new Error("Send button not found"), "selector_missing");
  sendBtn.click();

  await humanPause(1500, 2500);
  return { sentAt: new Date().toISOString(), conversationUrl: location.href };
}

function waitFor(sel: string, timeoutMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = document.querySelector(sel);
    if (found) return resolve(found);
    const start = Date.now();
    const id = setInterval(() => {
      const el = document.querySelector(sel);
      if (el) { clearInterval(id); return resolve(el); }
      if (Date.now() - start > timeoutMs) { clearInterval(id); return resolve(null); }
    }, 200);
  });
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
