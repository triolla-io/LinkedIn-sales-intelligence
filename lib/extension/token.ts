import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): { raw: string; hash: string; prefix: string } {
  const raw = randomBytes(36).toString("base64url").slice(0, 48);
  const hash = hashToken(raw);
  return { raw, hash, prefix: raw.slice(0, 8) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function verifyToken(raw: string, expectedHash: string): boolean {
  const a = Buffer.from(hashToken(raw), "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
