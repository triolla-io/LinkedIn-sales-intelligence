import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/linkedin/sse-bus";
import { mcpSendMessage, extractUsername, extractProfileUrn } from "@/lib/linkedin/mcp-http-client";

export const sendMessage = inngest.createFunction(
  { id: "send-message", triggers: [{ event: "message.send" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event }: any) => {
    const { messageId } = event.data as { messageId: string };

    const sentMessage = await prisma.sentMessage.findUnique({
      where: { id: messageId },
      include: { contact: true },
    });
    if (!sentMessage) throw new Error(`SentMessage ${messageId} not found`);

    try {
      const username = extractUsername(sentMessage.contact.linkedinUrl, sentMessage.contact.linkedinUrn);
      const profileUrn = extractProfileUrn(sentMessage.contact.linkedinUrn);
      await mcpSendMessage(username, sentMessage.body, profileUrn);
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
    }

    publish(sentMessage.senderId, { type: "message:sent", data: { messageId } });
    return { messageId };
  }
);
