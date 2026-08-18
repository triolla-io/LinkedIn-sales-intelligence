/**
 * Queue ONE extension task by hand, for verifying the extension end-to-end against the
 * local dev stack (the extension's api-base must point at http://localhost:3001).
 *
 *   npx tsx --env-file=.env scripts/create-extension-test-task.ts SCRAPE_PROFILE https://www.linkedin.com/in/someone/
 *   npx tsx --env-file=.env scripts/create-extension-test-task.ts PREPARE_MESSAGE https://www.linkedin.com/in/someone/ "טקסט"
 *   npx tsx --env-file=.env scripts/create-extension-test-task.ts CONNECT https://www.linkedin.com/in/someone/
 *
 * SCRAPE_PROFILE and PREPARE_MESSAGE make no outward change on LinkedIn (a profile view /
 * an unsent draft). CONNECT and SEND do — they send a real invitation / message.
 */

import { prisma } from "../lib/prisma";

const USER_EMAIL = process.env.TEST_USER_EMAIL ?? "ariel@triolla.io";

const KINDS = ["SCRAPE_PROFILE", "PREPARE_MESSAGE", "CONNECT", "SEND", "SEARCH", "RESOLVE_COMPANY"] as const;
type Kind = (typeof KINDS)[number];

function payloadFor(kind: Kind, target: string, text: string | undefined) {
  switch (kind) {
    case "SCRAPE_PROFILE":
      return { linkedinUrl: target };
    case "PREPARE_MESSAGE":
    case "SEND":
      if (!text) throw new Error(`${kind} needs a message text as the 3rd argument`);
      return { linkedinUrl: target, text };
    case "CONNECT":
      return { profileUrl: target };
    case "SEARCH":
      return { searchUrl: target };
    case "RESOLVE_COMPANY":
      return target.startsWith("http") ? { linkedinUrl: target } : { name: target };
  }
}

async function main() {
  const [kindArg, target, text] = process.argv.slice(2);
  const kind = kindArg as Kind;
  if (!KINDS.includes(kind) || !target) {
    console.error(`usage: <${KINDS.join("|")}> <url-or-name> [text]`);
    process.exit(1);
  }

  const user = await prisma.user.findFirstOrThrow({
    where: { email: USER_EMAIL },
    select: { id: true, email: true, extensionSession: { select: { version: true, lastSeenAt: true } } },
  });
  const session = user.extensionSession;
  console.log(
    `user: ${user.email} · extension ${session?.version ?? "unknown"} · last seen ${
      session?.lastSeenAt?.toISOString() ?? "never"
    }`,
  );

  const task = await prisma.extensionTask.create({
    data: {
      userId: user.id,
      kind,
      payload: payloadFor(kind, target, text) as object,
      scheduledFor: new Date(Date.now() - 1000),
    },
  });
  console.log(`queued ${kind} ${task.id} → ${target}`);
  console.log("the extension polls every 30s; read the result with scripts/debug-tasks.ts");
}

main().finally(() => prisma.$disconnect());
