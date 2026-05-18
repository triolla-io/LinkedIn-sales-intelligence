import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.LINKEDIN_COOKIE_ENC_KEY;
  if (!raw) throw new Error("LINKEDIN_COOKIE_ENC_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `LINKEDIN_COOKIE_ENC_KEY must be 32 bytes when base64-decoded, got ${key.length}`
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string and returns a base64-encoded blob of:
 *   IV (12 bytes) | auth tag (16 bytes) | ciphertext
 */
export function encryptCookie(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypts a blob produced by `encryptCookie`.
 * Throws if the key is wrong or the ciphertext was tampered with.
 */
export function decryptCookie(blob: string): string {
  const key = getKey();
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
