import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { LinkedinMcp } from "@/lib/linkedin/mcp-client";
import { decryptCookie } from "@/lib/linkedin/cookie-crypto";
import { publish } from "@/lib/linkedin/sse-bus";

export const sendMessage = inngest.createFunction(
  { id: "send-message", triggers: [{ event: "message.send" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event }: any) => {
    const { messageId } = event.data as { messageId: string };

    const sentMessage = await prisma.sentMessage.findUnique({
      where: { id: messageId },
      include: {
        sender: { include: { linkedinSession: true } },
        contact: true,
      },
    });

    if (!sentMessage) throw new Error(`SentMessage ${messageId} not found`);

    const session = sentMessage.sender.linkedinSession;
    if (!session) throw new Error("No LinkedIn session for sender");

    let mcp: LinkedinMcp | null = null;
    try {
      const cookie = decryptCookie(session.encryptedCookie);
      mcp = await LinkedinMcp.open(cookie);
      await mcp.sendMessage(sentMessage.contact.linkedinUrn, sentMessage.body, sentMessage.contact.linkedinUrl);
      await prisma.sentMessage.update({
        where: { id: messageId },
        data: { status: "SENT", sentAt: new Date() },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.sentMessage.update({
        where: { id: messageId },
        data: { status: "FAILED", errorMessage: msg },
      });
    } finally {
      await mcp?.close();
    }

    publish(sentMessage.senderId, { type: "message:sent", data: { messageId } });
    return { messageId };
  }
);
