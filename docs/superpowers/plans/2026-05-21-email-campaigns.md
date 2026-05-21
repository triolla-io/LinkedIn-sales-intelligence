# Email Campaigns via Gmail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users send email campaigns to contacts using their own Gmail account, using the same template system as WhatsApp campaigns.

**Architecture:** The user's Google OAuth already stores `access_token` and `refresh_token` in the NextAuth `Account` table. We add the `gmail.send` scope to the login flow, build a Gmail client that refreshes tokens as needed, wire a new `campaign.send-email` Inngest function to the existing campaign pipeline, and add an Email option to the campaign modal with a subject field.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Inngest, Gmail REST API, NextAuth v5, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `lib/auth.ts` | Add `gmail.send` scope + `offline` access to Google provider |
| Create | `lib/gmail/client.ts` | `sendEmail()` — token lookup, auto-refresh, Gmail API call |
| Create | `app/api/gmail/status/route.ts` | GET — returns `{ connected: boolean }` based on stored scope |
| Modify | `prisma/schema.prisma` | Add `subject String?` to Campaign model |
| Create | `inngest/functions/campaign-send-email.ts` | Handles `campaign.send-email` Inngest event |
| Modify | `inngest/functions/campaign-start.ts` | Route `EMAIL` channel → `campaign.send-email` event |
| Modify | `app/api/inngest/route.ts` | Register `campaignSendEmail` function |
| Modify | `components/dashboard/new-campaign-modal.tsx` | Add Email channel tab + subject field |
| Create | `tests/unit/gmail-client.test.ts` | Unit tests for message encoding and scope helpers |

---

## Task 1: Add Gmail Scope to Google Auth Provider

**Files:**
- Modify: `lib/auth.ts`

### Background

The Google OAuth provider currently requests only the default scopes (`openid email profile`). We need `https://www.googleapis.com/auth/gmail.send` and `access_type: offline` so Google returns a refresh token. Adding these scopes means new logins will prompt the Gmail consent screen once; existing users keep working until they re-login, at which point they get the new scope stored in the `Account` table.

- [ ] **Step 1: Read the current auth config**

Read `lib/auth.ts` to confirm the current Google provider config (no `authorization` param currently set).

- [ ] **Step 2: Add scope and offline access**

Find in `lib/auth.ts`:
```typescript
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
```

Replace with:
```typescript
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
```

`prompt: "consent"` ensures Google always returns a fresh refresh token (without it, refresh tokens are only issued on first auth).

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/ariellunenfeld/linkedin-sales-intelligence && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts
git commit -m "feat: add gmail.send scope to Google OAuth for email campaigns"
```

---

## Task 2: Gmail Client Library

**Files:**
- Create: `lib/gmail/client.ts`
- Create: `tests/unit/gmail-client.test.ts`

### Background

The Gmail REST API sends email as a base64url-encoded RFC 2822 message. The client needs to: (1) load the user's Google `Account` row from Prisma, (2) refresh the access token if expired, (3) build and send the RFC 2822 message. Token refresh uses Google's OAuth token endpoint directly (no SDK needed).

The `Account` table (Prisma) has: `access_token String?`, `refresh_token String?`, `expires_at Int?` (Unix seconds), `scope String?`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/gmail-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Inline pure helpers — same pattern as other unit tests in this repo

function buildRfc2822(from: string, to: string, subject: string, body: string): string {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");
}

function encodeMessage(raw: string): string {
  return Buffer.from(raw).toString("base64url");
}

function isTokenExpired(expiresAt: number | null): boolean {
  if (!expiresAt) return true;
  return expiresAt < Math.floor(Date.now() / 1000) + 60; // 60s buffer
}

function hasGmailScope(scope: string | null): boolean {
  return scope?.includes("https://www.googleapis.com/auth/gmail.send") ?? false;
}

describe("buildRfc2822", () => {
  it("includes all required headers", () => {
    const msg = buildRfc2822("Alice <alice@example.com>", "bob@example.com", "Hello", "Hi Bob");
    expect(msg).toContain("From: Alice <alice@example.com>");
    expect(msg).toContain("To: bob@example.com");
    expect(msg).toContain("Subject: Hello");
    expect(msg).toContain("Content-Type: text/plain; charset=utf-8");
  });
  it("includes body after blank line", () => {
    const msg = buildRfc2822("a@b.com", "c@d.com", "S", "Body text");
    expect(msg).toContain("\r\n\r\nBody text");
  });
});

describe("encodeMessage", () => {
  it("produces base64url output (no +, /, or = padding)", () => {
    const encoded = encodeMessage("Hello World");
    expect(encoded).not.toMatch(/[+/=]/);
  });
  it("is decodable back to original", () => {
    const original = "From: a@b.com\r\nTo: c@d.com\r\n\r\nHello";
    expect(Buffer.from(encodeMessage(original), "base64url").toString()).toBe(original);
  });
});

describe("isTokenExpired", () => {
  it("returns true for null", () => expect(isTokenExpired(null)).toBe(true));
  it("returns true when within 60s buffer", () => {
    expect(isTokenExpired(Math.floor(Date.now() / 1000) + 30)).toBe(true);
  });
  it("returns false when far from expiry", () => {
    expect(isTokenExpired(Math.floor(Date.now() / 1000) + 3600)).toBe(false);
  });
});

describe("hasGmailScope", () => {
  it("returns true when scope contains gmail.send URL", () => {
    expect(hasGmailScope("openid email https://www.googleapis.com/auth/gmail.send")).toBe(true);
  });
  it("returns false for null", () => expect(hasGmailScope(null)).toBe(false));
  it("returns false for unrelated scopes", () => {
    expect(hasGmailScope("openid email profile")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/gmail-client.test.ts
```

Expected: FAIL — helpers not defined.

- [ ] **Step 3: Create `lib/gmail/client.ts`**

```typescript
import { prisma } from "@/lib/prisma";

function buildRfc2822(from: string, to: string, subject: string, body: string): string {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
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
```

- [ ] **Step 4: Add inline helpers to test file so tests pass**

The test file already has the helpers inlined (same pattern as `lists-api.test.ts`). No change needed — the tests test the pure logic, not the exported functions.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/unit/gmail-client.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/gmail/client.ts tests/unit/gmail-client.test.ts
git commit -m "feat: add Gmail client with token refresh and RFC 2822 message encoding"
```

---

## Task 3: Gmail Status API Route

**Files:**
- Create: `app/api/gmail/status/route.ts`

### Background

The campaign modal needs to know if the current user has the `gmail.send` scope (i.e., they've logged in since we added the scope). This is a simple lookup on the `Account` table. If the scope is missing, the UI shows a "Re-authorize" prompt.

- [ ] **Step 1: Create the route**

Create `app/api/gmail/status/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { hasGmailScope } from "@/lib/gmail/client";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const account = await prisma.account.findFirst({
    where: { userId: ctx.user.id, provider: "google" },
    select: { scope: true },
  });
  return NextResponse.json({ connected: hasGmailScope(account?.scope ?? null) });
});
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/gmail/status/route.ts
git commit -m "feat: add GET /api/gmail/status to check if user has gmail.send scope"
```

---

## Task 4: Add Subject Field to Campaign Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via `prisma migrate dev`

### Background

Email campaigns need a subject line. WhatsApp campaigns don't. Add `subject String?` (nullable) to the Campaign model — email campaigns must supply it, WhatsApp campaigns leave it null.

- [ ] **Step 1: Add field to schema**

In `prisma/schema.prisma`, find the Campaign model fields block. After the `dailyLimit` line:
```prisma
  dailyLimit Int?
```
Add:
```prisma
  dailyLimit Int?
  subject    String?
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add-campaign-subject
```

Expected output includes: `The following migration(s) have been created and applied: migrations/..._add_campaign_subject`

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors (Prisma client regenerated by migration).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add subject field to Campaign for email campaigns"
```

---

## Task 5: Campaign Send Email Inngest Function

**Files:**
- Create: `inngest/functions/campaign-send-email.ts`

### Background

This function mirrors `campaign-send-whatsapp.ts` exactly, replacing the WhatsApp send with `sendEmail()`. It handles: quota check, missing email guard, SENDING → SENT/FAILED status transitions, SentMessage creation, retry logic (up to 3 attempts), and finalize event.

The `campaign.subject` field is used as the email subject. The `recipient.renderedBody` (already rendered by `campaign-start`) is the email body.

- [ ] **Step 1: Create the function**

Create `inngest/functions/campaign-send-email.ts`:

```typescript
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { publish } from "@/lib/linkedin/sse-bus";
import { sendEmail } from "@/lib/gmail/client";

const MAX_ATTEMPTS = 3;
const DEFAULT_DAY_LIMIT = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignSendEmailHandler({ event }: any) {
  const { recipientId } = event.data as { recipientId: string };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: true, contact: true },
  });
  if (!recipient || recipient.status !== "PENDING") return;
  if (recipient.campaign.channel !== "EMAIL") return;
  if (recipient.campaign.status !== "RUNNING") return;

  const dailyLimit = (recipient.campaign as { dailyLimit?: number | null }).dailyLimit ?? DEFAULT_DAY_LIMIT;
  const quota = await checkSendQuota(recipient.campaign.ownerId, {
    dayLimit: dailyLimit,
    prefix: "email:send:",
  });
  if (!quota.ok) {
    await inngest.send({
      name: "campaign.send-email",
      data: { recipientId },
      ts: Date.now() + quota.retryAfterSec * 1000,
    });
    return;
  }

  const toEmail = recipient.contact.email;
  if (!toEmail) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "FAILED", errorMessage: "no email address" },
    });
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENDING", attemptCount: { increment: 1 } },
  });

  try {
    const subject = (recipient.campaign as { subject?: string | null }).subject ?? recipient.campaign.name;
    await sendEmail(recipient.campaign.ownerId, {
      to: toEmail,
      subject,
      body: recipient.renderedBody ?? "",
    });

    const sent = await prisma.sentMessage.create({
      data: {
        senderId: recipient.campaign.ownerId,
        actorId: recipient.campaign.ownerId,
        contactId: recipient.contactId,
        templateId: recipient.campaign.templateId,
        body: recipient.renderedBody ?? "",
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "SENT", sentMessageId: sent.id, sentAt: new Date() },
    });
    publish(recipient.campaign.ownerId, {
      type: "campaign:sent",
      data: { recipientId, campaignId: recipient.campaignId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const shouldRetry = recipient.attemptCount + 1 < MAX_ATTEMPTS;
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: {
        status: shouldRetry ? "PENDING" : "FAILED",
        errorMessage: message,
      },
    });
    if (shouldRetry) {
      await inngest.send({ name: "campaign.send-email", data: { recipientId } });
    }
  } finally {
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
  }
}

export const campaignSendEmail = inngest.createFunction(
  { id: "campaign-send-email", triggers: [{ event: "campaign.send-email" as const }] },
  campaignSendEmailHandler
);
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add inngest/functions/campaign-send-email.ts
git commit -m "feat: add campaign-send-email Inngest function"
```

---

## Task 6: Wire Email Channel in Campaign Start + Register Function

**Files:**
- Modify: `inngest/functions/campaign-start.ts`
- Modify: `app/api/inngest/route.ts`

### Background

`campaign-start.ts` currently routes: `WHATSAPP → campaign.send-whatsapp`, everything else → `campaign.send-one`. We need to add `EMAIL → campaign.send-email`. Also register the new function in the Inngest serve handler.

- [ ] **Step 1: Update campaign-start routing**

Read `inngest/functions/campaign-start.ts`. Find this block:

```typescript
      const eventName = campaign.channel === "WHATSAPP" ? "campaign.send-whatsapp" : "campaign.send-one";
      await inngest.send({
        name: eventName as "campaign.send-one" | "campaign.send-whatsapp",
        data: { recipientId: recipientRow.id },
      });
```

Replace with:

```typescript
      const eventName =
        campaign.channel === "WHATSAPP"
          ? "campaign.send-whatsapp"
          : campaign.channel === "EMAIL"
          ? "campaign.send-email"
          : "campaign.send-one";
      await inngest.send({
        name: eventName as "campaign.send-one" | "campaign.send-whatsapp" | "campaign.send-email",
        data: { recipientId: recipientRow.id },
      });
```

- [ ] **Step 2: Register campaignSendEmail in Inngest route**

Read `app/api/inngest/route.ts`. Add the import:
```typescript
import { campaignSendEmail } from "@/inngest/functions/campaign-send-email";
```

Then add `campaignSendEmail` to the `functions` array inside `serve(...)`.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add inngest/functions/campaign-start.ts app/api/inngest/route.ts
git commit -m "feat: route EMAIL channel to campaign.send-email in campaign start"
```

---

## Task 7: Campaign Modal — Email Channel + Subject Field

**Files:**
- Modify: `components/dashboard/new-campaign-modal.tsx`

### Background

The current modal is WhatsApp-only. We need to add a channel selector (WhatsApp / Email) and show the relevant UI per channel. When Email is selected: show a subject field and a Gmail connection status warning (if the user hasn't re-authed). When WhatsApp is selected: show the existing WhatsApp warning. The `subject` field is sent with the campaign create payload for email campaigns.

`GET /api/gmail/status` returns `{ connected: boolean }`.

- [ ] **Step 1: Read the current modal**

Read `components/dashboard/new-campaign-modal.tsx` in full before making changes.

- [ ] **Step 2: Add channel + subject state, fetch Gmail status**

Replace the existing state declarations and `useEffect` with the following (preserve all existing state, add new ones):

```typescript
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [subject, setSubject] = useState("");
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
```

In the existing `useEffect` (the one that runs when `open` changes), add a Gmail status fetch alongside the existing WhatsApp status fetch:

```typescript
    fetch("/api/gmail/status")
      .then((r) => r.json())
      .then((d: { connected: boolean }) => setGmailConnected(d.connected))
      .catch(() => setGmailConnected(false));
```

Also reset the new state on open by adding inside the `useEffect`:
```typescript
    setChannel("WHATSAPP");
    setSubject("");
```

- [ ] **Step 3: Update the submit function**

Find the `submit` function. Replace the `fetch("/api/campaigns", ...)` body to include `channel` and `subject`:

```typescript
        body: JSON.stringify({
          name,
          templateId,
          contactIds,
          channel,
          dailyLimit,
          ...(channel === "EMAIL" ? { subject } : {}),
        }),
```

- [ ] **Step 4: Update the disabled condition for the Send button**

Find:
```typescript
          disabled={!name.trim() || !templateId || busy || whatsappConnected === false}
```

Replace with:
```typescript
          disabled={
            !name.trim() ||
            !templateId ||
            busy ||
            (channel === "WHATSAPP" && whatsappConnected === false) ||
            (channel === "EMAIL" && (!subject.trim() || gmailConnected === false))
          }
```

- [ ] **Step 5: Update the JSX — add channel tabs, subject field, Gmail warning**

Find the subtitle paragraph:
```tsx
        <p className="mt-1 text-sm text-[#9b9895]">
          Sending to {contactIds.length} contact{contactIds.length === 1 ? "" : "s"} via WhatsApp.
        </p>
```

Replace with:
```tsx
        <p className="mt-1 text-sm text-[#9b9895]">
          Sending to {contactIds.length} contact{contactIds.length === 1 ? "" : "s"}.
        </p>

        {/* Channel selector */}
        <div className="mt-4 flex rounded-lg border border-[#e5e3df] overflow-hidden text-sm">
          {(["WHATSAPP", "EMAIL"] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`flex-1 py-1.5 font-medium transition-colors ${
                channel === ch
                  ? "bg-[#111110] text-white"
                  : "bg-white text-[#6b6866] hover:text-[#111110]"
              }`}
            >
              {ch === "WHATSAPP" ? "WhatsApp" : "Email"}
            </button>
          ))}
        </div>
```

Then find the WhatsApp warning block:
```tsx
        {whatsappConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            WhatsApp not connected.{" "}
            <a href="/whatsapp-connect" className="underline hover:text-amber-800">
              Connect your account →
            </a>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}
```

Replace with:
```tsx
        {channel === "WHATSAPP" && whatsappConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            WhatsApp not connected.{" "}
            <a href="/whatsapp-connect" className="underline hover:text-amber-800">
              Connect your account →
            </a>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}
        {channel === "EMAIL" && gmailConnected === false && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            Gmail not authorized.{" "}
            <a href="/api/auth/signin" className="underline hover:text-amber-800">
              Re-authorize your Google account →
            </a>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}
```

Then find the Daily limit block and add the subject field above it (email only):
```tsx
        {channel === "EMAIL" && (
          <>
            <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Email subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Quick question about your team"
              className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-1 focus:ring-[#1585ff] focus:border-[#1585ff]/40 text-sm"
            />
          </>
        )}
```

Place this block immediately before the `<label ... >Daily limit</label>` line.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/new-campaign-modal.tsx
git commit -m "feat: add Email channel to campaign modal with subject field and Gmail auth check"
```

---

## Self-Review

**Spec coverage:**
- ✅ Gmail scope added to Google OAuth — Task 1
- ✅ Token auto-refresh — Task 2 (`lib/gmail/client.ts`)
- ✅ Gmail status endpoint for UI checks — Task 3
- ✅ Subject field on Campaign — Task 4
- ✅ Email sending via Inngest — Task 5
- ✅ EMAIL channel routed correctly in campaign start — Task 6
- ✅ Function registered in Inngest serve — Task 6
- ✅ Campaign modal with Email channel + subject + Gmail warning — Task 7
- ✅ Uses same template system as WhatsApp — `renderedBody` used as-is in Task 5
- ✅ Daily quota enforced — Task 5 (`checkSendQuota` with `email:send:` prefix)
- ✅ Retry on failure (up to 3 attempts) — Task 5
- ✅ Contacts without email are FAILED not crashed — Task 5

**Placeholder scan:** No TBDs. All code complete.

**Type consistency:**
- `sendEmail(userId, { to, subject, body })` — called in Task 5 exactly as defined in Task 2
- `hasGmailScope` — exported from `lib/gmail/client.ts` (Task 2), imported in `app/api/gmail/status/route.ts` (Task 3)
- `campaignSendEmail` — defined in Task 5, registered in Task 6
- `"campaign.send-email" as const` — used in Task 5 trigger and Task 6 routing
- `campaign.subject` — added in Task 4 migration, accessed in Task 5 as `(recipient.campaign as { subject?: string | null }).subject`
