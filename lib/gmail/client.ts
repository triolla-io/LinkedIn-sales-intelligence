import { prisma } from "@/lib/prisma";

function encodeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
}

function isHebrew(text: string): boolean {
  return /[֐-׿]/.test(text);
}

function bodyToHtml(body: string): string {
  const dir = isHebrew(body) ? "rtl" : "ltr";
  const align = dir === "rtl" ? "right" : "left";
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${dir === "rtl" ? "he" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    body { margin:0; padding:0; background:#ffffff; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
    td { padding:0; }
    p { margin:0 0 1em 0; }
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td dir="${dir}" style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:16px;line-height:1.75;color:#1a1a1a;text-align:${align};">
              ${escaped}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildRfc2822(from: string, to: string, subject: string, body: string): string {
  const html = bodyToHtml(body);
  const encodedBody = Buffer.from(html).toString("base64");
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
  { to, subject, body }: { to: string; subject: string; body: string }
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

  const raw = buildRfc2822(from, to, subject, body);
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
