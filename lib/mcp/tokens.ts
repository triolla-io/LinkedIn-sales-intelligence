import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** A raw token: shown to the user exactly once, never persisted. */
export function generateRawToken(): string {
  return "mcp_" + randomBytes(32).toString("base64url");
}

/** What we actually store — a one-way hash of the raw token. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createToken(userId: string, label: string) {
  const raw = generateRawToken();
  const { id } = await prisma.mcpAccessToken.create({
    data: { userId, label, tokenHash: hashToken(raw) },
    select: { id: true },
  });
  return { id, raw };
}

export async function listTokens(userId: string) {
  return prisma.mcpAccessToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, lastUsedAt: true, createdAt: true, revokedAt: true },
  });
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const res = await prisma.mcpAccessToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}
