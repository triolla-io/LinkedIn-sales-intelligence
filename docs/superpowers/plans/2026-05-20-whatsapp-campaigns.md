# WhatsApp Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WhatsApp as a campaign channel — each user connects their personal number via QR code, and campaigns send templated messages through a Baileys sidecar service.

**Architecture:** A Node.js sidecar (`whatsapp-service/`) owns all Baileys WebSocket connections and exposes a simple HTTP API. Next.js proxies session management through `/api/whatsapp/*` routes. A new Inngest function `campaign-send-whatsapp` handles WhatsApp campaign sends, parallel to the existing `campaign-send-one` LinkedIn function.

**Tech Stack:** Baileys (`@whiskeysockets/baileys`), Express (sidecar), `libphonenumber-js` (phone normalization), Vitest (tests), Prisma migration, Inngest, Next.js App Router

---

## File Map

**New files:**
- `whatsapp-service/package.json` — sidecar dependencies
- `whatsapp-service/tsconfig.json` — sidecar TS config
- `whatsapp-service/src/session-manager.ts` — Baileys session lifecycle per user
- `whatsapp-service/src/index.ts` — Express HTTP server
- `lib/whatsapp/phone.ts` — phone normalization (E.164)
- `lib/whatsapp/client.ts` — Next.js HTTP client for sidecar
- `app/api/whatsapp/status/route.ts` — proxy session status
- `app/api/whatsapp/qr/route.ts` — proxy QR SSE stream
- `app/api/whatsapp/disconnect/route.ts` — proxy disconnect
- `inngest/functions/campaign-send-whatsapp.ts` — send handler
- `app/(dashboard)/whatsapp-connect/page.tsx` — connect page
- `components/dashboard/whatsapp-connect-card.tsx` — QR UI component
- `tests/unit/phone-normalize.test.ts` — phone unit tests

**Modified files:**
- `prisma/schema.prisma` — add `dailyLimit Int?` to Campaign
- `lib/campaigns/throttle.ts` — add `dayLimit` + `prefix` params to `checkSendQuota`
- `inngest/functions/campaign-send-one.ts` — early return if channel ≠ LINKEDIN
- `app/api/inngest/route.ts` — register `campaignSendWhatsapp`
- `app/api/campaigns/route.ts` — accept `channel` + `dailyLimit` in POST body
- `app/api/campaigns/[id]/start/route.ts` — validate correct session per channel
- `components/dashboard/sidebar.tsx` — add WhatsApp nav entry
- `components/dashboard/new-campaign-modal.tsx` — channel selector + daily limit field
- `package.json` — add `libphonenumber-js`

---

## Task 1: Prisma schema — add `dailyLimit` to Campaign

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add field to Campaign model**

In `prisma/schema.prisma`, inside the `Campaign` model after `filterJson  Json?`, add:

```prisma
dailyLimit  Int?
```

The model should now read:
```prisma
model Campaign {
  id          String           @id @default(cuid())
  ownerId     String
  orgId       String?
  name        String
  channel     CampaignChannel
  templateId  String
  status      CampaignStatus   @default(DRAFT)
  filterJson  Json?
  dailyLimit  Int?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  owner      User                @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  template   MessageTemplate     @relation(fields: [templateId], references: [id])
  recipients CampaignRecipient[]

  @@index([ownerId, status])
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
npx prisma migrate dev --name add_campaign_daily_limit
```

Expected: migration file created and applied, no errors.

- [ ] **Step 3: Verify generated client**

```bash
npx prisma generate
```

Expected: `@/lib/generated/prisma` types updated, `Campaign` type includes `dailyLimit: number | null`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add dailyLimit to Campaign"
```

---

## Task 2: Phone normalization utility + tests

**Files:**
- Create: `lib/whatsapp/phone.ts`
- Create: `tests/unit/phone-normalize.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install libphonenumber-js**

```bash
npm install libphonenumber-js
```

Expected: package added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/phone-normalize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/whatsapp/phone";

describe("normalizePhone", () => {
  it("returns E.164 for a valid E.164 input", () => {
    expect(normalizePhone("+16505551234")).toBe("+16505551234");
  });

  it("strips spaces and dashes", () => {
    expect(normalizePhone("+1 650-555-1234")).toBe("+16505551234");
  });

  it("adds leading + if missing", () => {
    expect(normalizePhone("16505551234")).toBe("+16505551234");
  });

  it("handles Israeli mobile numbers", () => {
    expect(normalizePhone("+972501234567")).toBe("+972501234567");
  });

  it("returns null for a short garbage string", () => {
    expect(normalizePhone("not-a-phone")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(normalizePhone("   ")).toBeNull();
  });

  it("strips parentheses and dots", () => {
    expect(normalizePhone("+1 (650) 555.1234")).toBe("+16505551234");
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/phone-normalize.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/whatsapp/phone'`

- [ ] **Step 4: Implement `lib/whatsapp/phone.ts`**

```typescript
import { parsePhoneNumber } from "libphonenumber-js";

export function normalizePhone(input: string): string | null {
  if (!input?.trim()) return null;
  try {
    const cleaned = input.replace(/[\s\-\(\)\.]/g, "");
    const withPlus = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
    const parsed = parsePhoneNumber(withPlus);
    if (!parsed?.isValid()) return null;
    return parsed.format("E.164");
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/phone-normalize.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp/phone.ts tests/unit/phone-normalize.test.ts package.json package-lock.json
git commit -m "feat(whatsapp): add phone normalization utility"
```

---

## Task 3: Update throttle to support configurable day limit

**Files:**
- Modify: `lib/campaigns/throttle.ts`

- [ ] **Step 1: Update `checkSendQuota` to accept options**

Replace the entire `lib/campaigns/throttle.ts` with:

```typescript
import { Redis } from "@upstash/redis";

const HOUR_LIMIT = 20;
const DEFAULT_DAY_LIMIT = 80;

export type QuotaResult = { ok: true } | { ok: false; retryAfterSec: number; reason: "hour" | "day" };

export async function checkSendQuota(
  userId: string,
  options?: { dayLimit?: number; prefix?: string }
): Promise<QuotaResult> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return { ok: true };
  const redis = Redis.fromEnv();
  const prefix = options?.prefix ?? "li:send:";
  const dayLimit = options?.dayLimit ?? DEFAULT_DAY_LIMIT;

  const hourKey = `${prefix}${userId}:h:${Math.floor(Date.now() / 3_600_000)}`;
  const dayKey  = `${prefix}${userId}:d:${Math.floor(Date.now() / 86_400_000)}`;

  const [hourCount, dayCount] = await Promise.all([redis.incr(hourKey), redis.incr(dayKey)]);
  await Promise.all([redis.expire(hourKey, 3600), redis.expire(dayKey, 86400)]);

  if (hourCount > HOUR_LIMIT) {
    const ms = 3_600_000 - (Date.now() % 3_600_000);
    return { ok: false, retryAfterSec: Math.ceil(ms / 1000), reason: "hour" };
  }
  if (dayCount > dayLimit) {
    const ms = 86_400_000 - (Date.now() % 86_400_000);
    return { ok: false, retryAfterSec: Math.ceil(ms / 1000), reason: "day" };
  }
  return { ok: true };
}

export function jitterSeconds(): number {
  return 45 + Math.floor(Math.random() * 76); // 45–120s
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors related to throttle.ts (existing callers pass only `userId` which still works since `options` is optional).

- [ ] **Step 3: Commit**

```bash
git add lib/campaigns/throttle.ts
git commit -m "feat(throttle): support configurable dayLimit and key prefix"
```

---

## Task 4: WhatsApp sidecar service

**Files:**
- Create: `whatsapp-service/package.json`
- Create: `whatsapp-service/tsconfig.json`
- Create: `whatsapp-service/src/session-manager.ts`
- Create: `whatsapp-service/src/index.ts`

- [ ] **Step 1: Create `whatsapp-service/package.json`**

```json
{
  "name": "whatsapp-service",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@hapi/boom": "^10.0.1",
    "@whiskeysockets/baileys": "^6.7.16",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/express": "^5.0.1",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create `whatsapp-service/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install sidecar dependencies**

```bash
cd whatsapp-service && npm install && cd ..
```

Expected: `node_modules` created inside `whatsapp-service/`.

- [ ] **Step 4: Create `whatsapp-service/src/session-manager.ts`**

```typescript
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as fs from "fs";
import * as path from "path";

const SESSIONS_DIR =
  process.env.WHATSAPP_SESSIONS_DIR ?? path.join(process.cwd(), "whatsapp-sessions");

type SessionStatus = "CONNECTED" | "QR_PENDING" | "DISCONNECTED";
type EventListener = (event: "qr" | "connected" | "disconnected", data: string) => void;

interface SessionEntry {
  socket: WASocket;
  status: SessionStatus;
  qr?: string;
  phone?: string;
  listeners: Set<EventListener>;
}

const sessions = new Map<string, SessionEntry>();

export function getStatus(userId: string): { status: SessionStatus; phone?: string } {
  const entry = sessions.get(userId);
  if (!entry) return { status: "DISCONNECTED" };
  return { status: entry.status, phone: entry.phone };
}

export function subscribeToEvents(userId: string, listener: EventListener): () => void {
  const entry = sessions.get(userId);
  if (entry) {
    entry.listeners.add(listener);
    if (entry.status === "QR_PENDING" && entry.qr) {
      listener("qr", entry.qr);
    } else if (entry.status === "CONNECTED") {
      listener("connected", entry.phone ?? "");
    }
  }
  return () => sessions.get(userId)?.listeners.delete(listener);
}

export async function initSession(userId: string): Promise<void> {
  if (sessions.has(userId)) return;

  const dir = path.join(SESSIONS_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const socket = makeWASocket({ auth: state, printQRInTerminal: false });

  const entry: SessionEntry = {
    socket,
    status: "DISCONNECTED",
    listeners: new Set(),
  };
  sessions.set(userId, entry);

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      entry.status = "QR_PENDING";
      entry.qr = qr;
      entry.listeners.forEach((l) => l("qr", qr));
    }

    if (connection === "open") {
      entry.status = "CONNECTED";
      entry.qr = undefined;
      const rawId = socket.user?.id ?? "";
      entry.phone = `+${rawId.split(":")[0]}`;
      entry.listeners.forEach((l) => l("connected", entry.phone!));
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      entry.status = "DISCONNECTED";
      entry.listeners.forEach((l) => l("disconnected", loggedOut ? "logged_out" : "reconnecting"));
      sessions.delete(userId);

      if (loggedOut) {
        fs.rmSync(dir, { recursive: true, force: true });
      } else {
        setTimeout(() => initSession(userId), 3000);
      }
    }
  });
}

export async function disconnectSession(userId: string): Promise<void> {
  const entry = sessions.get(userId);
  if (entry) {
    try { await entry.socket.logout(); } catch { /* ignore */ }
    entry.socket.end(undefined);
    sessions.delete(userId);
  }
  const dir = path.join(SESSIONS_DIR, userId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function sendMessage(userId: string, phone: string, body: string): Promise<string> {
  const entry = sessions.get(userId);
  if (!entry || entry.status !== "CONNECTED") {
    throw new Error("WhatsApp not connected for this user");
  }
  const jid = `${phone.replace("+", "")}@s.whatsapp.net`;
  const result = await entry.socket.sendMessage(jid, { text: body });
  return result?.key.id ?? "";
}

export async function restoreAllSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const userIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  await Promise.all(userIds.map(initSession));
  console.log(`Restored ${userIds.length} WhatsApp session(s)`);
}
```

- [ ] **Step 5: Create `whatsapp-service/src/index.ts`**

```typescript
import express from "express";
import {
  initSession,
  getStatus,
  subscribeToEvents,
  disconnectSession,
  sendMessage,
  restoreAllSessions,
} from "./session-manager";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.WHATSAPP_SERVICE_PORT ?? "3002", 10);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/session/:userId/status", (req, res) => {
  res.json(getStatus(req.params.userId));
});

app.get("/session/:userId/qr", async (req, res) => {
  const { userId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  await initSession(userId);

  const cleanup = subscribeToEvents(userId, (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify({ data })}\n\n`);
    if (event === "connected" || event === "disconnected") {
      cleanup();
      res.end();
    }
  });

  req.on("close", cleanup);
});

app.post("/session/:userId/disconnect", async (req, res) => {
  await disconnectSession(req.params.userId);
  res.status(204).send();
});

app.post("/send", async (req, res) => {
  const { userId, phone, body } = req.body as {
    userId?: string;
    phone?: string;
    body?: string;
  };

  if (!userId || !phone || typeof body !== "string") {
    return res.status(400).json({ error: "userId, phone, and body are required" });
  }

  try {
    const messageId = await sendMessage(userId, phone, body);
    res.json({ messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not connected")) {
      return res.status(401).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

restoreAllSessions().then(() => {
  app.listen(PORT, () => console.log(`WhatsApp service on port ${PORT}`));
});
```

- [ ] **Step 6: Verify sidecar compiles**

```bash
cd whatsapp-service && npx tsc --noEmit && cd ..
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add whatsapp-service/
git commit -m "feat(whatsapp-service): add Baileys sidecar HTTP service"
```

---

## Task 5: Next.js WhatsApp client + API proxy routes

**Files:**
- Create: `lib/whatsapp/client.ts`
- Create: `app/api/whatsapp/status/route.ts`
- Create: `app/api/whatsapp/qr/route.ts`
- Create: `app/api/whatsapp/disconnect/route.ts`

- [ ] **Step 1: Create `lib/whatsapp/client.ts`**

```typescript
const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL ?? "http://localhost:3002";

export type WaStatus = "CONNECTED" | "QR_PENDING" | "DISCONNECTED";

export const waClient = {
  async status(userId: string): Promise<{ status: WaStatus; phone?: string }> {
    try {
      const res = await fetch(`${WHATSAPP_SERVICE_URL}/session/${userId}/status`);
      if (!res.ok) return { status: "DISCONNECTED" };
      return res.json();
    } catch {
      return { status: "DISCONNECTED" };
    }
  },

  async disconnect(userId: string): Promise<void> {
    await fetch(`${WHATSAPP_SERVICE_URL}/session/${userId}/disconnect`, {
      method: "POST",
    });
  },

  async send(
    userId: string,
    phone: string,
    body: string
  ): Promise<{ messageId: string }> {
    const res = await fetch(`${WHATSAPP_SERVICE_URL}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, phone, body }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `WhatsApp send failed: ${res.status}`);
    }
    return res.json();
  },

  qrStreamUrl(userId: string): string {
    return `${WHATSAPP_SERVICE_URL}/session/${userId}/qr`;
  },
};
```

- [ ] **Step 2: Create `app/api/whatsapp/status/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { waClient } from "@/lib/whatsapp/client";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const data = await waClient.status(ctx.effectiveUserId);
  return NextResponse.json(data);
});
```

- [ ] **Step 3: Create `app/api/whatsapp/disconnect/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { waClient } from "@/lib/whatsapp/client";

export const POST = withTenant(async (_req: NextRequest, ctx) => {
  await waClient.disconnect(ctx.effectiveUserId);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 4: Create `app/api/whatsapp/qr/route.ts`**

The QR route proxies the SSE stream from the sidecar. The sidecar requires the session to be initialized first — calling `GET /session/:userId/qr` on the sidecar triggers `initSession` automatically.

```typescript
import { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";

const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL ?? "http://localhost:3002";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const upstream = await fetch(
    `${WHATSAPP_SERVICE_URL}/session/${ctx.effectiveUserId}/qr`
  );

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp/client.ts app/api/whatsapp/
git commit -m "feat(whatsapp): add Next.js client and API proxy routes"
```

---

## Task 6: Update `campaign-send-one` to skip non-LinkedIn campaigns

**Files:**
- Modify: `inngest/functions/campaign-send-one.ts`

- [ ] **Step 1: Add early return guard**

In `inngest/functions/campaign-send-one.ts`, after the existing guard `if (!recipient || recipient.status !== "PENDING") return;`, add:

```typescript
if (recipient.campaign.channel !== "LINKEDIN") return;
```

The top of `campaignSendOneHandler` should now read:

```typescript
export async function campaignSendOneHandler({ event }: any) {
  const { recipientId } = event.data as { recipientId: string };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: {
      campaign: true,
      contact: true,
    },
  });
  if (!recipient || recipient.status !== "PENDING") return;
  if (recipient.campaign.channel !== "LINKEDIN") return;
  if (recipient.campaign.status !== "RUNNING") return;
  // ... rest unchanged
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add inngest/functions/campaign-send-one.ts
git commit -m "feat(campaigns): skip non-LinkedIn recipients in campaign-send-one"
```

---

## Task 7: WhatsApp Inngest function + registration

**Files:**
- Create: `inngest/functions/campaign-send-whatsapp.ts`
- Modify: `app/api/inngest/route.ts`

- [ ] **Step 1: Create `inngest/functions/campaign-send-whatsapp.ts`**

```typescript
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { publish } from "@/lib/linkedin/sse-bus";
import { waClient } from "@/lib/whatsapp/client";
import { normalizePhone } from "@/lib/whatsapp/phone";

const MAX_ATTEMPTS = 3;
const DEFAULT_DAY_LIMIT = 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignSendWhatsappHandler({ event }: any) {
  const { recipientId } = event.data as { recipientId: string };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: true, contact: true },
  });
  if (!recipient || recipient.status !== "PENDING") return;
  if (recipient.campaign.channel !== "WHATSAPP") return;
  if (recipient.campaign.status !== "RUNNING") return;

  const dailyLimit = (recipient.campaign as { dailyLimit?: number | null }).dailyLimit ?? DEFAULT_DAY_LIMIT;
  const quota = await checkSendQuota(recipient.campaign.ownerId, {
    dayLimit: dailyLimit,
    prefix: "wa:send:",
  });
  if (!quota.ok) {
    await inngest.send({
      name: "campaign.send-one",
      data: { recipientId },
    });
    return;
  }

  const rawPhone = recipient.contact.phone;
  if (!rawPhone) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "FAILED", errorMessage: "no phone number" },
    });
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
    return;
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "FAILED", errorMessage: "invalid phone number" },
    });
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENDING", attemptCount: { increment: 1 } },
  });

  try {
    const { messageId } = await waClient.send(
      recipient.campaign.ownerId,
      phone,
      recipient.renderedBody ?? ""
    );

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

    void messageId; // stored in SentMessage body; WA messageId not persisted separately
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
      await inngest.send({ name: "campaign.send-one", data: { recipientId } });
    }
  } finally {
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
  }
}

export const campaignSendWhatsapp = inngest.createFunction(
  { id: "campaign-send-whatsapp", triggers: [{ event: "campaign.send-one" as const }] },
  campaignSendWhatsappHandler
);
```

- [ ] **Step 2: Register in `app/api/inngest/route.ts`**

Replace the entire file content:

```typescript
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { campaignStart } from "@/inngest/functions/campaign-start";
import { campaignSendOne } from "@/inngest/functions/campaign-send-one";
import { campaignSendWhatsapp } from "@/inngest/functions/campaign-send-whatsapp";
import { campaignFinalize } from "@/inngest/functions/campaign-finalize";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichContact,
    enrichCompanies,
    enrichCompaniesWeb,
    campaignStart,
    campaignSendOne,
    campaignSendWhatsapp,
    campaignFinalize,
  ],
});
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add inngest/functions/campaign-send-whatsapp.ts app/api/inngest/route.ts
git commit -m "feat(campaigns): add WhatsApp Inngest send function"
```

---

## Task 8: Update campaigns API to accept `channel` and `dailyLimit`

**Files:**
- Modify: `app/api/campaigns/route.ts`

- [ ] **Step 1: Update POST handler to accept `channel` and `dailyLimit`**

Replace the entire `app/api/campaigns/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json();
  const { name, templateId, contactIds, listId, filter, channel, dailyLimit } = body as {
    name?: string;
    templateId?: string;
    contactIds?: string[];
    listId?: string;
    filter?: unknown;
    channel?: string;
    dailyLimit?: number;
  };

  if (!name || !templateId) {
    return NextResponse.json({ error: "name and templateId required" }, { status: 400 });
  }
  if (!contactIds && !listId && filter === undefined) {
    return NextResponse.json({ error: "contactIds, listId, or filter required" }, { status: 400 });
  }

  const resolvedChannel = channel === "WHATSAPP" ? "WHATSAPP" : "LINKEDIN";

  const tpl = await prisma.messageTemplate.findFirst({ where: { id: templateId, ownerId: ctx.effectiveUserId } });
  if (!tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });

  let resolvedContactIds = contactIds;
  if (listId && !resolvedContactIds) {
    const list = await prisma.contactList.findFirst({
      where: { id: listId, ownerId: ctx.effectiveUserId },
    });
    if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });
    const members = await prisma.contactListMember.findMany({
      where: { listId },
      select: { contactId: true },
    });
    resolvedContactIds = members.map((m) => m.contactId);
  }

  const filterJson = resolvedContactIds ? { contactIds: resolvedContactIds } : { filter };
  const campaign = await prisma.campaign.create({
    data: {
      ownerId: ctx.effectiveUserId,
      orgId: ctx.org.id,
      name,
      channel: resolvedChannel,
      templateId,
      status: "DRAFT",
      filterJson: filterJson as never,
      dailyLimit: resolvedChannel === "WHATSAPP" && dailyLimit ? dailyLimit : null,
    },
  });
  return NextResponse.json({ campaign }, { status: 201 });
});

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const campaigns = await prisma.campaign.findMany({
    where: { ownerId: ctx.effectiveUserId },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } }, _count: { select: { recipients: true } } },
  });
  return NextResponse.json({ campaigns });
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/campaigns/route.ts
git commit -m "feat(campaigns): accept channel and dailyLimit in campaign creation"
```

---

## Task 9: Update campaign start route to validate correct session per channel

**Files:**
- Modify: `app/api/campaigns/[id]/start/route.ts`

- [ ] **Step 1: Update start route**

Replace the entire `app/api/campaigns/[id]/start/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";
import { waClient } from "@/lib/whatsapp/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const campaign = await prisma.campaign.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (campaign.status !== "DRAFT") return NextResponse.json({ error: "campaign must be DRAFT to start" }, { status: 409 });

    if (campaign.channel === "LINKEDIN") {
      const linkedinSession = await prisma.linkedinSession.findUnique({ where: { userId: ctx.effectiveUserId } });
      if (!linkedinSession || linkedinSession.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "LINKEDIN_NOT_CONNECTED", message: "Connect your LinkedIn account before starting this campaign." },
          { status: 403 }
        );
      }
    }

    if (campaign.channel === "WHATSAPP") {
      const { status } = await waClient.status(ctx.effectiveUserId);
      if (status !== "CONNECTED") {
        return NextResponse.json(
          { error: "WHATSAPP_NOT_CONNECTED", message: "Connect your WhatsApp account before starting this campaign." },
          { status: 403 }
        );
      }
    }

    await prisma.campaign.update({ where: { id }, data: { status: "QUEUED" } });
    await inngest.send({ name: "campaign.start", data: { campaignId: id } });
    return NextResponse.json({ ok: true });
  })(req);
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/campaigns/[id]/start/route.ts
git commit -m "feat(campaigns): validate WhatsApp session on campaign start"
```

---

## Task 10: WhatsApp connect UI page and component

**Files:**
- Create: `components/dashboard/whatsapp-connect-card.tsx`
- Create: `app/(dashboard)/whatsapp-connect/page.tsx`

- [ ] **Step 1: Create `components/dashboard/whatsapp-connect-card.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

type WaStatus = "CONNECTED" | "QR_PENDING" | "DISCONNECTED" | "LOADING";

export function WhatsAppConnectCard() {
  const [status, setStatus] = useState<WaStatus>("LOADING");
  const [phone, setPhone] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then((d: { status: WaStatus; phone?: string }) => {
        setStatus(d.status);
        if (d.phone) setPhone(d.phone);
      })
      .catch(() => setStatus("DISCONNECTED"));
  }, []);

  useEffect(() => {
    if (status !== "DISCONNECTED" && status !== "LOADING") return;
    if (status !== "DISCONNECTED") return;

    const es = new EventSource("/api/whatsapp/qr");

    es.addEventListener("qr", (e) => {
      const { data } = JSON.parse(e.data) as { data: string };
      setStatus("QR_PENDING");
      setQr(data);
    });

    es.addEventListener("connected", (e) => {
      const { data } = JSON.parse(e.data) as { data: string };
      setStatus("CONNECTED");
      setPhone(data);
      setQr(null);
      es.close();
    });

    es.addEventListener("disconnected", () => {
      setStatus("DISCONNECTED");
      es.close();
    });

    es.onerror = () => es.close();

    return () => es.close();
  }, [status]);

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/whatsapp/disconnect", { method: "POST" });
    setStatus("DISCONNECTED");
    setPhone(null);
    setQr(null);
    setDisconnecting(false);
  }

  if (status === "LOADING") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <p className="text-sm text-[#9b9895]">Checking connection…</p>
      </div>
    );
  }

  if (status === "CONNECTED") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#111110]">WhatsApp connected</p>
            {phone && <p className="text-xs text-[#9b9895] mt-0.5">{phone}</p>}
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="mt-4 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors disabled:opacity-50"
        >
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
      <h2 className="text-base font-semibold text-[#111110]">Connect WhatsApp</h2>
      <p className="mt-1 text-sm text-[#9b9895]">
        Scan the QR code with WhatsApp on your phone to connect your personal number.
      </p>
      <ol className="mt-3 text-sm text-[#6b6866] list-decimal list-inside space-y-1">
        <li>Open WhatsApp on your phone</li>
        <li>Tap Menu (⋮) → Linked Devices → Link a Device</li>
        <li>Scan the code below</li>
      </ol>

      <div className="mt-5 flex justify-center">
        {status === "QR_PENDING" && qr ? (
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`}
            alt="WhatsApp QR code"
            className="w-[220px] h-[220px] rounded-lg border border-[#e5e3df]"
          />
        ) : (
          <div className="w-[220px] h-[220px] rounded-lg border border-[#e5e3df] bg-[#f8f7f5] flex items-center justify-center">
            <p className="text-xs text-[#9b9895]">Waiting for QR…</p>
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-[#9b9895]">QR refreshes automatically every ~20 seconds</p>
    </div>
  );
}
```

**Note:** The QR code image above uses `api.qrserver.com` to render the raw QR string as an image — this sends the QR data to an external service. If that's a concern, replace with a local QR renderer like `qrcode.react`. For now this is the simplest approach.

- [ ] **Step 2: Create `app/(dashboard)/whatsapp-connect/page.tsx`**

```tsx
import { WhatsAppConnectCard } from "@/components/dashboard/whatsapp-connect-card";

export default function WhatsAppConnectPage() {
  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      <h1 className="text-xl font-semibold text-[#111110] mb-6">WhatsApp</h1>
      <WhatsAppConnectCard />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/whatsapp-connect-card.tsx app/(dashboard)/whatsapp-connect/
git commit -m "feat(ui): add WhatsApp connect page with QR code"
```

---

## Task 11: Sidebar + new campaign modal updates

**Files:**
- Modify: `components/dashboard/sidebar.tsx`
- Modify: `components/dashboard/new-campaign-modal.tsx`

- [ ] **Step 1: Add WhatsApp to sidebar nav**

In `components/dashboard/sidebar.tsx`, add `MessageCircle` to the lucide-react import:

```typescript
import { Users, FileText, Shield, LogOut, LayoutDashboard, Wifi, Upload, MessageCircle } from "lucide-react";
```

Then add the WhatsApp entry to `navItems` after the LinkedIn entry:

```typescript
const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/import", label: "Import CSV", icon: Upload },
  { href: "/linkedin-connect", label: "LinkedIn", icon: Wifi },
  { href: "/whatsapp-connect", label: "WhatsApp", icon: MessageCircle },
];
```

- [ ] **Step 2: Update new campaign modal to support WhatsApp**

Replace the entire `components/dashboard/new-campaign-modal.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Template = { id: string; name: string; body: string };
type Channel = "LINKEDIN" | "WHATSAPP";

export function NewCampaignModal({
  open,
  onClose,
  contactIds,
}: {
  open: boolean;
  onClose: () => void;
  contactIds: string[];
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("LINKEDIN");
  const [dailyLimit, setDailyLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedinConnected, setLinkedinConnected] = useState<boolean | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setChannel("LINKEDIN");
    setDailyLimit(100);

    fetch("/api/linkedin/session")
      .then((r) => r.json())
      .then((d) => setLinkedinConnected(d.status === "ACTIVE"))
      .catch(() => setLinkedinConnected(false));

    fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then((d: { status: string }) => setWhatsappConnected(d.status === "CONNECTED"))
      .catch(() => setWhatsappConnected(false));

    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => {
        const tpls: Template[] = j.templates ?? [];
        setTemplates(tpls);
        if (tpls[0]) setTemplateId(tpls[0].id);
      })
      .catch(() => setError("Failed to load templates"));
  }, [open]);

  if (!open) return null;

  const preview = templates.find((t) => t.id === templateId)?.body ?? "";
  const channelNotConnected =
    (channel === "LINKEDIN" && linkedinConnected === false) ||
    (channel === "WHATSAPP" && whatsappConnected === false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          templateId,
          contactIds,
          channel,
          dailyLimit: channel === "WHATSAPP" ? dailyLimit : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create campaign"); return; }
      const startRes = await fetch(`/api/campaigns/${json.campaign.id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const startJson = await startRes.json();
        setError(startJson.message ?? startJson.error ?? "Failed to start campaign");
        return;
      }
      router.push(`/campaigns/${json.campaign.id}`);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onClose}>
      <div
        className="w-[520px] rounded-xl border border-[#e5e3df] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[#111110]">New campaign</h2>
        <p className="mt-1 text-sm text-[#9b9895]">
          Sending to {contactIds.length} contact{contactIds.length === 1 ? "" : "s"}.
        </p>

        <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Channel</label>
        <div className="mt-1 flex gap-2">
          {(["LINKEDIN", "WHATSAPP"] as Channel[]).map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                channel === c
                  ? "border-[#1585ff] bg-[#eff5ff] text-[#1585ff] font-medium"
                  : "border-[#e5e3df] text-[#6b6866] hover:border-[#9b9895]"
              }`}
            >
              {c === "LINKEDIN" ? "LinkedIn" : "WhatsApp"}
            </button>
          ))}
        </div>

        {channelNotConnected && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            {channel === "LINKEDIN" ? "LinkedIn" : "WhatsApp"} not connected.{" "}
            <a
              href={channel === "LINKEDIN" ? "/linkedin-connect" : "/whatsapp-connect"}
              className="underline hover:text-amber-800"
            >
              Connect your account →
            </a>{" "}
            You won&apos;t be able to send until it&apos;s connected.
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Campaign name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CTO outreach May 2026"
          className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-1 focus:ring-[#1585ff] focus:border-[#1585ff]/40 text-sm"
        />

        {channel === "WHATSAPP" && (
          <>
            <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Daily limit</label>
            <input
              type="number"
              min={10}
              max={500}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Math.min(500, Math.max(10, parseInt(e.target.value) || 10)))}
              className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] focus:outline-none focus:ring-1 focus:ring-[#1585ff] text-sm"
            />
            <p className="mt-1 text-xs text-[#9b9895]">Messages per day (10–500). Lower = safer from bans.</p>
          </>
        )}

        <label className="mt-4 block text-xs uppercase tracking-wide text-[#9b9895] font-mono">Template</label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="mt-1 w-full rounded-lg bg-[#f8f7f5] border border-[#e5e3df] px-3 py-2 text-[#111110] focus:outline-none focus:ring-1 focus:ring-[#1585ff] text-sm"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {preview && (
          <div className="mt-2 rounded-lg bg-[#f8f7f5] border border-[#e5e3df] p-3 text-xs text-[#6b6866] whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
            {preview}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || !templateId || busy || channelNotConnected}
            className="rounded-lg bg-[#1585ff] px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-[#0a70e0] transition-colors"
          >
            {busy ? "Starting…" : "Send Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all unit tests**

```bash
npx vitest run
```

Expected: all tests pass including the new phone normalization tests.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sidebar.tsx components/dashboard/new-campaign-modal.tsx
git commit -m "feat(ui): add WhatsApp channel to sidebar and campaign modal"
```

---

## Environment Variables

Add to `.env.local` (and production secrets):

```bash
WHATSAPP_SERVICE_URL=http://localhost:3002
WHATSAPP_SERVICE_PORT=3002
WHATSAPP_SESSIONS_DIR=./whatsapp-sessions
```

---

## Running the full stack

Start both services:

```bash
# Terminal 1 — Next.js
npm run dev

# Terminal 2 — WhatsApp sidecar
cd whatsapp-service && npm run dev
```

Then navigate to `/whatsapp-connect`, scan the QR code, create a WhatsApp campaign from the contacts page.
