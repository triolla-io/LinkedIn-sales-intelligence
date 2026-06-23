import { prisma } from "@/lib/prisma";
import { composeEmailHtml, escapeHtml } from "@/lib/email/render";

export { escapeHtml };

function encodeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
}

export function htmlBody(body: string, signatureHtml?: string | null): string {
  return composeEmailHtml(body, signatureHtml);
}

export function buildRfc2822(
  from: string,
  to: string,
  subject: string,
  body: string,
  signatureHtml?: string | null
): string {
  const encodedBody = Buffer.from(htmlBody(body, signatureHtml)).toString("base64");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    encodedBody,
  ].join("\r\n");
}

function encodeMessage(raw: string): string {
  return Buffer.from(raw).toString("base64url");
}

function isTokenExpired(expiresAt: number | null): boolean {
  if (!expiresAt) return true;
  return expiresAt < Math.floor(Date.now() / 1000) + 60;
}

export function hasGmailScope(scope: string | null): boolean {
  return scope?.includes("https://www.googleapis.com/auth/gmail.send") ?? false;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${text}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token as string,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in as number),
  };
}

export async function sendEmail(
  userId: string,
  { to, subject, body, signatureHtml }: { to: string; subject: string; body: string; signatureHtml?: string | null }
): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) throw new Error("NO_GOOGLE_ACCOUNT");
  if (!hasGmailScope(account.scope ?? null)) throw new Error("GMAIL_SCOPE_MISSING");

  let accessToken = account.access_token!;

  if (isTokenExpired(account.expires_at ?? null)) {
    if (!account.refresh_token) throw new Error("NO_REFRESH_TOKEN");
    const refreshed = await refreshAccessToken(account.refresh_token);
    accessToken = refreshed.accessToken;
    await prisma.account.update({
      where: { id: account.id },
      data: { access_token: accessToken, expires_at: refreshed.expiresAt },
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  const from = user?.name ? `${user.name} <${user.email}>` : (user?.email ?? "unknown");

  const raw = buildRfc2822(from, to, subject, body, signatureHtml);
  const encoded = encodeMessage(raw);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.id as string;
}
