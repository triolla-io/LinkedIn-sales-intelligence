import { SEL } from "./selectors";
import { humanPause, sleep, humanDelay } from "../human/timing";

export async function checkForReply(sinceIso: string): Promise<{
  replyDetected: boolean;
  replies: Array<{ text: string; at: string }>;
}> {
  await humanPause(1500, 3500);
  await sleep(humanDelay(800));

  const since = new Date(sinceIso).getTime();
  const items = Array.from(document.querySelectorAll(SEL.conversationMessages));
  const replies: Array<{ text: string; at: string }> = [];

  for (const li of items) {
    const authorEl = li.querySelector(SEL.messageAuthor) as HTMLElement | null;
    const author = authorEl?.innerText ?? "";
    if (author.toLowerCase().includes("you") || author === "") continue;

    const bodyEl = li.querySelector(SEL.messageBody) as HTMLElement | null;
    const body = bodyEl?.innerText?.trim() ?? "";
    if (!body) continue;

    const tsEl = li.querySelector(SEL.messageTimestamp) as HTMLElement | null;
    const at = parseLinkedinTime(tsEl);
    if (at.getTime() > since) {
      replies.push({ text: body, at: at.toISOString() });
    }
  }

  return { replyDetected: replies.length > 0, replies };
}

function parseLinkedinTime(el: HTMLElement | null): Date {
  if (!el) return new Date();
  const dt = el.getAttribute("datetime") ?? el.innerText ?? "";
  const d = new Date(dt);
  return isNaN(d.getTime()) ? new Date() : d;
}
