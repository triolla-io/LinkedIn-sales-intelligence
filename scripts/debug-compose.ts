// Opens a LinkedIn profile and waits — keeps tab open so you can inspect it
import { prisma } from "../lib/prisma";

const PROFILE_URL = "https://www.linkedin.com/in/yuvalbaror1/";

async function main() {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "ariel@triolla.io" },
    select: { id: true },
  });

  // Create a task that will open the tab and click Message, but NOT type or close
  // We do this by setting a special debug payload
  const task = await prisma.extensionTask.create({
    data: {
      userId: user.id,
      kind: "SEND",
      payload: {
        linkedinUrl: PROFILE_URL,
        text: "DEBUG_KEEP_OPEN",  // extension won't send this text
      },
      scheduledFor: new Date(Date.now() - 1000),
    },
  });

  console.log("Task created:", task.id);
  console.log("Extension will open LinkedIn and click Message.");
  console.log("Then: F12 on the LinkedIn tab → Console → paste this:");
  console.log(`
// Find all input-like elements (paste in LinkedIn tab console after chat opens):
const all = [
  ...document.querySelectorAll('input,textarea,[contenteditable],[role="textbox"]'),
  ...document.querySelectorAll('[class*="compose"],[class*="msg-form"],[class*="chat"]')
].filter(e => {
  const r = e.getBoundingClientRect();
  return r.width > 50 && r.height > 0;
}).map(e => ({
  tag: e.tagName,
  class: e.className?.slice(0,80),
  role: e.getAttribute('role'),
  aria: e.getAttribute('aria-label'),
  placeholder: e.getAttribute('placeholder') || e.getAttribute('data-placeholder'),
  ce: e.getAttribute('contenteditable'),
  h: Math.round(e.getBoundingClientRect().height),
  w: Math.round(e.getBoundingClientRect().width),
}));
console.log(JSON.stringify(all, null, 2));
`);
}

main().finally(() => prisma.$disconnect());
