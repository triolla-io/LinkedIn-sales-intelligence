# Outreach Campaigns — Phase 1 (LinkedIn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user filter their contacts, pick a template, hit Send, and have the app deliver that LinkedIn message to every matched contact — throttled, tracked, resumable.

**Architecture:** New `Campaign` + `CampaignRecipient` Prisma models. A template renderer supports recipient (`{{firstName}}`) and sender (`{{senderFirstName}}`) variables with `|default` fallback syntax. Inngest fan-out drives sends: `campaign.start` → one `campaign.send-one` per recipient → `campaign.finalize`. Each `send-one` reuses the existing `LinkedinMcp.sendMessage` path (which already drives the Python message-sender via the user's encrypted cookie). Per-user throttling via Upstash. A `LINKEDIN_SEND_MODE=mock` env flag short-circuits the real sender for dev/CI.

**Tech Stack:** Next.js 16 + App Router, Prisma 7 (Postgres), Inngest 4, Upstash Redis, Vitest, Playwright, Tailwind 4, existing browserless/Patchright LinkedIn automation.

**Spec:** [docs/superpowers/specs/2026-05-19-outreach-campaigns-design.md](../specs/2026-05-19-outreach-campaigns-design.md)

---

## File Structure

**Created:**
- `lib/campaigns/render-template.ts` — pure template substitution (recipient + sender vars, `|default` fallback)
- `lib/campaigns/throttle.ts` — Upstash-backed per-user rate limiter (20/hr, 80/24h)
- `lib/campaigns/audience.ts` — resolves filterJson or explicit contactIds to a list of Contact rows
- `inngest/functions/campaign-start.ts`
- `inngest/functions/campaign-send-one.ts`
- `inngest/functions/campaign-finalize.ts`
- `app/api/campaigns/route.ts` — POST (create), GET (list)
- `app/api/campaigns/[id]/route.ts` — GET (detail)
- `app/api/campaigns/[id]/start/route.ts` — POST
- `app/api/campaigns/[id]/pause/route.ts` — POST
- `app/api/campaigns/[id]/resume/route.ts` — POST
- `app/api/campaigns/[id]/cancel/route.ts` — POST
- `app/(dashboard)/campaigns/page.tsx` — list (server component)
- `app/(dashboard)/campaigns/campaigns-client.tsx` — list client wrapper
- `app/(dashboard)/campaigns/[id]/page.tsx` — detail (server component)
- `app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx` — live updating client
- `components/dashboard/new-campaign-modal.tsx` — modal launched from contacts page
- Tests under `tests/campaigns/` and `tests/api/campaigns/`

**Modified:**
- `prisma/schema.prisma` — add `Campaign`, `CampaignRecipient`, enums; add `title` field to `User`
- `inngest/client.ts` — register new functions (if it has an explicit list)
- `app/api/inngest/route.ts` — same, if explicit
- `components/dashboard/bulk-enrich-bar.tsx` — add "Send Campaign" button
- `lib/linkedin/mcp-client.ts` — add a `mock` mode gate at the top of `sendMessage` honoring `LINKEDIN_SEND_MODE=mock`

---

## Task 1: Prisma schema additions

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums and models**

Append to `prisma/schema.prisma`:

```prisma
enum CampaignChannel { LINKEDIN EMAIL WHATSAPP }
enum CampaignStatus  { DRAFT QUEUED RUNNING PAUSED COMPLETED CANCELLED }
enum RecipientStatus { PENDING SENDING SENT FAILED SKIPPED }

model Campaign {
  id          String           @id @default(cuid())
  ownerId     String
  orgId       String?
  name        String
  channel     CampaignChannel
  templateId  String
  status      CampaignStatus   @default(DRAFT)
  filterJson  Json?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  owner      User                @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  template   MessageTemplate     @relation(fields: [templateId], references: [id])
  recipients CampaignRecipient[]

  @@index([ownerId, status])
}

model CampaignRecipient {
  id            String          @id @default(cuid())
  campaignId    String
  contactId     String
  status        RecipientStatus @default(PENDING)
  renderedBody  String?
  sentMessageId String?         @unique
  errorMessage  String?
  attemptCount  Int             @default(0)
  scheduledAt   DateTime?
  sentAt        DateTime?

  campaign    Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contact     Contact      @relation(fields: [contactId], references: [id])
  sentMessage SentMessage? @relation(fields: [sentMessageId], references: [id])

  @@unique([campaignId, contactId])
  @@index([campaignId, status])
}
```

In `model User`, add inside the field block:
```prisma
  title         String?
```

In `model User`, add to relations:
```prisma
  campaigns     Campaign[]
```

In `model MessageTemplate`, add to relations:
```prisma
  campaigns Campaign[]
```

In `model Contact`, add to relations:
```prisma
  campaignRecipients CampaignRecipient[]
```

In `model SentMessage`, add to relations:
```prisma
  campaignRecipient CampaignRecipient?
```

- [ ] **Step 2: Generate & push**

Run:
```bash
npm run db:generate && npm run db:push
```
Expected: schema sync succeeds, generated client at `lib/generated/prisma` updated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma lib/generated/prisma
git commit -m "feat(campaigns): add Campaign and CampaignRecipient models"
```

---

## Task 2: Template renderer

**Files:**
- Create: `lib/campaigns/render-template.ts`
- Test: `tests/campaigns/render-template.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/campaigns/render-template.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/campaigns/render-template";

const ctx = {
  recipient: { firstName: "Alice", lastName: "Cohen", company: "Acme", title: "CTO" },
  sender:    { firstName: "Daniel", lastName: "Levi",  company: "Triolla", title: "CEO" },
};

describe("renderTemplate", () => {
  it("substitutes recipient variables", () => {
    expect(renderTemplate("Hi {{firstName}} at {{company}}", ctx).body)
      .toBe("Hi Alice at Acme");
  });
  it("substitutes sender variables", () => {
    expect(renderTemplate("From {{senderFirstName}} ({{senderCompany}})", ctx).body)
      .toBe("From Daniel (Triolla)");
  });
  it("applies default fallback when value missing", () => {
    const ctx2 = { ...ctx, recipient: { ...ctx.recipient, firstName: null } };
    expect(renderTemplate("Hi {{firstName|there}}", ctx2).body).toBe("Hi there");
  });
  it("returns missing variable list when no fallback and no value", () => {
    const ctx2 = { ...ctx, recipient: { ...ctx.recipient, firstName: null } };
    const res = renderTemplate("Hi {{firstName}}", ctx2);
    expect(res.body).toBe("");
    expect(res.missing).toEqual(["firstName"]);
  });
  it("treats missing sender variables as empty (no skip)", () => {
    const ctx2 = { ...ctx, sender: { ...ctx.sender, title: null } };
    const res = renderTemplate("Best, {{senderFirstName}} {{senderTitle}}", ctx2);
    expect(res.body).toBe("Best, Daniel ");
    expect(res.missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `npm run test -- render-template`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement renderer**

Create `lib/campaigns/render-template.ts`:
```ts
export type RenderContext = {
  recipient: { firstName: string | null; lastName: string | null; company: string | null; title: string | null };
  sender:    { firstName: string | null; lastName: string | null; company: string | null; title: string | null };
};

const RECIPIENT_VARS = ["firstName", "lastName", "company", "title"] as const;
const SENDER_VARS    = ["senderFirstName", "senderLastName", "senderCompany", "senderTitle"] as const;

export function renderTemplate(template: string, ctx: RenderContext): { body: string; missing: string[] } {
  const missing: string[] = [];
  const body = template.replace(/\{\{([a-zA-Z]+)(?:\|([^}]*))?\}\}/g, (_m, name, fallback) => {
    const value = lookup(name, ctx);
    if (value !== null && value !== "") return value;
    if (fallback !== undefined) return fallback;
    if ((SENDER_VARS as readonly string[]).includes(name)) return "";
    if ((RECIPIENT_VARS as readonly string[]).includes(name)) missing.push(name);
    return "";
  });
  return { body: missing.length > 0 ? "" : body, missing };
}

function lookup(name: string, ctx: RenderContext): string | null {
  switch (name) {
    case "firstName":       return ctx.recipient.firstName;
    case "lastName":        return ctx.recipient.lastName;
    case "company":         return ctx.recipient.company;
    case "title":           return ctx.recipient.title;
    case "senderFirstName": return ctx.sender.firstName;
    case "senderLastName":  return ctx.sender.lastName;
    case "senderCompany":   return ctx.sender.company;
    case "senderTitle":     return ctx.sender.title;
    default:                return null;
  }
}
```

- [ ] **Step 4: Verify PASS**

Run: `npm run test -- render-template`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/render-template.ts tests/campaigns/render-template.test.ts
git commit -m "feat(campaigns): add template renderer with recipient and sender variables"
```

---

## Task 3: Throttle helper

**Files:**
- Create: `lib/campaigns/throttle.ts`
- Test: `tests/campaigns/throttle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/campaigns/throttle.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkSendQuota } from "@/lib/campaigns/throttle";

const incr = vi.fn();
const expire = vi.fn();
const get = vi.fn();

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({ incr, expire, get }) },
}));

describe("checkSendQuota", () => {
  beforeEach(() => { incr.mockReset(); expire.mockReset(); get.mockReset(); });

  it("returns ok when under both limits", async () => {
    incr.mockResolvedValueOnce(5).mockResolvedValueOnce(10);
    expire.mockResolvedValue(1);
    const res = await checkSendQuota("user_1");
    expect(res).toEqual({ ok: true });
  });

  it("returns retryAfter when hourly cap exceeded", async () => {
    incr.mockResolvedValueOnce(21).mockResolvedValueOnce(21);
    expire.mockResolvedValue(1);
    const res = await checkSendQuota("user_1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryAfterSec).toBeGreaterThan(0);
  });

  it("returns retryAfter when daily cap exceeded", async () => {
    incr.mockResolvedValueOnce(5).mockResolvedValueOnce(81);
    expire.mockResolvedValue(1);
    const res = await checkSendQuota("user_1");
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm run test -- throttle`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/campaigns/throttle.ts`:
```ts
import { Redis } from "@upstash/redis";

const HOUR_LIMIT = 20;
const DAY_LIMIT  = 80;

export type QuotaResult = { ok: true } | { ok: false; retryAfterSec: number; reason: "hour" | "day" };

export async function checkSendQuota(userId: string): Promise<QuotaResult> {
  const redis = Redis.fromEnv();
  const hourKey = `li:send:${userId}:h:${Math.floor(Date.now() / 3_600_000)}`;
  const dayKey  = `li:send:${userId}:d:${Math.floor(Date.now() / 86_400_000)}`;

  const [hourCount, dayCount] = await Promise.all([redis.incr(hourKey), redis.incr(dayKey)]);
  await Promise.all([redis.expire(hourKey, 3600), redis.expire(dayKey, 86400)]);

  if (hourCount > HOUR_LIMIT) {
    const ms = 3_600_000 - (Date.now() % 3_600_000);
    return { ok: false, retryAfterSec: Math.ceil(ms / 1000), reason: "hour" };
  }
  if (dayCount > DAY_LIMIT) {
    const ms = 86_400_000 - (Date.now() % 86_400_000);
    return { ok: false, retryAfterSec: Math.ceil(ms / 1000), reason: "day" };
  }
  return { ok: true };
}

export function jitterSeconds(): number {
  return 45 + Math.floor(Math.random() * 76); // 45–120s
}
```

- [ ] **Step 4: Verify PASS**

Run: `npm run test -- throttle`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/throttle.ts tests/campaigns/throttle.test.ts
git commit -m "feat(campaigns): add per-user throttle helper backed by Upstash"
```

---

## Task 4: Audience resolver

**Files:**
- Create: `lib/campaigns/audience.ts`
- Test: `tests/campaigns/audience.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/campaigns/audience.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resolveAudience } from "@/lib/campaigns/audience";
import { prisma } from "@/lib/prisma";

describe("resolveAudience", () => {
  let userId: string;
  beforeEach(async () => {
    await prisma.contact.deleteMany();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({ data: { orgId: org.id, email: `u-${Date.now()}@x.com`, name: "U" } });
    userId = user.id;
    await prisma.contact.createMany({
      data: [
        { ownerId: userId, linkedinUrn: "a", linkedinUrl: "https://x/a", fullName: "A", currentTitle: "CTO", companySize: 50, lastSyncedAt: new Date() },
        { ownerId: userId, linkedinUrn: "b", linkedinUrl: "https://x/b", fullName: "B", currentTitle: "CEO", companySize: 500, lastSyncedAt: new Date() },
      ],
    });
  });

  it("resolves by explicit contactIds", async () => {
    const [a] = await prisma.contact.findMany({ where: { ownerId: userId, linkedinUrn: "a" } });
    const ids = await resolveAudience(userId, { contactIds: [a.id] });
    expect(ids).toEqual([a.id]);
  });

  it("resolves by filterJson (companySize 10-300)", async () => {
    const ids = await resolveAudience(userId, { filter: { companySizeMin: 10, companySizeMax: 300 } });
    const [a] = await prisma.contact.findMany({ where: { ownerId: userId, linkedinUrn: "a" } });
    expect(ids).toEqual([a.id]);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm run test -- audience`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/campaigns/audience.ts`:
```ts
import { prisma } from "@/lib/prisma";

export type AudienceSpec =
  | { contactIds: string[] }
  | { filter: { companySizeMin?: number; companySizeMax?: number; seniority?: string[]; function?: string[]; titleContains?: string } };

export async function resolveAudience(userId: string, spec: AudienceSpec): Promise<string[]> {
  if ("contactIds" in spec) {
    const rows = await prisma.contact.findMany({
      where: { ownerId: userId, id: { in: spec.contactIds }, removedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  const f = spec.filter;
  const rows = await prisma.contact.findMany({
    where: {
      ownerId: userId,
      removedAt: null,
      ...(f.companySizeMin !== undefined ? { companySize: { gte: f.companySizeMin } } : {}),
      ...(f.companySizeMax !== undefined ? { companySize: { lte: f.companySizeMax } } : {}),
      ...(f.seniority ? { seniority: { in: f.seniority as never } } : {}),
      ...(f.function  ? { function:  { in: f.function  as never } } : {}),
      ...(f.titleContains ? { currentTitle: { contains: f.titleContains, mode: "insensitive" } } : {}),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Verify PASS**

Run: `npm run test -- audience`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/audience.ts tests/campaigns/audience.test.ts
git commit -m "feat(campaigns): add audience resolver for filterJson and explicit lists"
```

---

## Task 5: Mock mode in LinkedinMcp.sendMessage

**Files:**
- Modify: `lib/linkedin/mcp-client.ts` (the `sendMessage` method, around line 194)

- [ ] **Step 1: Add mock gate**

In `lib/linkedin/mcp-client.ts`, find:
```ts
async sendMessage(urn: string, body: string): Promise<{ messageId: string }> {
```

Replace the first line of the method body with:
```ts
async sendMessage(urn: string, body: string): Promise<{ messageId: string }> {
  if (process.env.LINKEDIN_SEND_MODE === "mock") {
    return { messageId: `mock-${urn}-${Date.now()}` };
  }
  // ... existing implementation continues
```

- [ ] **Step 2: Commit**

```bash
git add lib/linkedin/mcp-client.ts
git commit -m "feat(campaigns): honor LINKEDIN_SEND_MODE=mock in sendMessage"
```

---

## Task 6: `campaign.start` Inngest function

**Files:**
- Create: `inngest/functions/campaign-start.ts`
- Test: `tests/campaigns/campaign-start.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/campaigns/campaign-start.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const sentEvents: { name: string; data: unknown }[] = [];
vi.mock("@/inngest/client", () => ({
  inngest: {
    createFunction: (_opts: unknown, fn: unknown) => fn,
    send: vi.fn(async (e: { name: string; data: unknown }) => { sentEvents.push(e); }),
  },
}));

import { campaignStartHandler } from "@/inngest/functions/campaign-start";

describe("campaign.start handler", () => {
  let userId: string, campaignId: string, contactIds: string[];

  beforeEach(async () => {
    sentEvents.length = 0;
    await prisma.campaignRecipient.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.contact.deleteMany();
    const org = await prisma.organization.create({ data: { name: "O" } });
    const user = await prisma.user.create({ data: { orgId: org.id, email: `u${Date.now()}@x`, name: "Daniel", title: "CEO" } });
    userId = user.id;
    const tpl = await prisma.messageTemplate.create({ data: { ownerId: userId, name: "T", body: "Hi {{firstName}}, this is {{senderFirstName}}" } });
    const contacts = await Promise.all([
      prisma.contact.create({ data: { ownerId: userId, linkedinUrn: "a", linkedinUrl: "x", fullName: "Alice Cohen", currentTitle: "CTO", lastSyncedAt: new Date() } }),
      prisma.contact.create({ data: { ownerId: userId, linkedinUrn: "b", linkedinUrl: "x", fullName: "Bob Levi",   currentTitle: "CTO", lastSyncedAt: new Date() } }),
    ]);
    contactIds = contacts.map((c) => c.id);
    const c = await prisma.campaign.create({
      data: { ownerId: userId, name: "test", channel: "LINKEDIN", templateId: tpl.id, status: "QUEUED", filterJson: { contactIds } },
    });
    campaignId = c.id;
  });

  it("creates recipients with rendered bodies and emits one event per recipient", async () => {
    await campaignStartHandler({ event: { data: { campaignId } } });
    const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId } });
    expect(recipients).toHaveLength(2);
    expect(recipients[0].renderedBody).toContain("Daniel");
    expect(recipients.find((r) => r.contactId === contactIds[0])!.renderedBody).toContain("Alice");
    expect(sentEvents.filter((e) => e.name === "campaign.send-one")).toHaveLength(2);
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.status).toBe("RUNNING");
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm run test -- campaign-start`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `inngest/functions/campaign-start.ts`:
```ts
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/campaigns/render-template";
import { resolveAudience, type AudienceSpec } from "@/lib/campaigns/audience";
import { jitterSeconds } from "@/lib/campaigns/throttle";

function firstName(full: string | null): string | null {
  if (!full) return null;
  const [f] = full.trim().split(/\s+/);
  return f ?? null;
}
function lastName(full: string | null): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignStartHandler({ event }: any) {
  const { campaignId } = event.data as { campaignId: string };
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, owner: { include: { org: true } } },
  });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const spec: AudienceSpec = (campaign.filterJson as AudienceSpec) ?? { contactIds: [] };
  const contactIds = await resolveAudience(campaign.ownerId, spec);
  const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds } } });

  const sender = {
    firstName: firstName(campaign.owner.name),
    lastName:  lastName(campaign.owner.name),
    company:   campaign.owner.org?.name ?? null,
    title:     campaign.owner.title ?? null,
  };

  let cursor = Date.now();
  for (const contact of contacts) {
    const recipient = {
      firstName: firstName(contact.fullName),
      lastName:  lastName(contact.fullName),
      company:   contact.currentCompany,
      title:     contact.currentTitle,
    };
    const { body, missing } = renderTemplate(campaign.template.body, { recipient, sender });
    const status = missing.length > 0 ? "SKIPPED" : "PENDING";
    const errorMessage = missing.length > 0 ? `missing_variable:${missing.join(",")}` : null;
    const scheduledAt = new Date(cursor);
    cursor += jitterSeconds() * 1000;

    const recipientRow = await prisma.campaignRecipient.create({
      data: { campaignId, contactId: contact.id, status, renderedBody: body || null, errorMessage, scheduledAt },
    });

    if (status === "PENDING") {
      await inngest.send({
        name: "campaign.send-one",
        data: { recipientId: recipientRow.id },
        ts: scheduledAt.getTime(),
      });
    }
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "RUNNING", startedAt: new Date() },
  });
}

export const campaignStart = inngest.createFunction(
  { id: "campaign-start", triggers: [{ event: "campaign.start" as const }] },
  campaignStartHandler
);
```

- [ ] **Step 4: Verify PASS**

Run: `npm run test -- campaign-start`
Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add inngest/functions/campaign-start.ts tests/campaigns/campaign-start.test.ts
git commit -m "feat(campaigns): add campaign.start Inngest function"
```

---

## Task 7: `campaign.send-one` Inngest function

**Files:**
- Create: `inngest/functions/campaign-send-one.ts`
- Test: `tests/campaigns/campaign-send-one.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/campaigns/campaign-send-one.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_opts: unknown, fn: unknown) => fn, send: vi.fn() },
}));
vi.mock("@/lib/campaigns/throttle", () => ({
  checkSendQuota: vi.fn(async () => ({ ok: true })),
  jitterSeconds: () => 1,
}));

const openMock = vi.fn();
vi.mock("@/lib/linkedin/mcp-client", () => ({
  LinkedinMcp: { open: openMock },
  RateLimitError: class extends Error {},
}));

beforeEach(() => {
  process.env.LINKEDIN_SEND_MODE = "mock";
  openMock.mockReset();
  openMock.mockResolvedValue({
    sendMessage: vi.fn(async () => ({ messageId: "mock-1" })),
    close: vi.fn(),
  });
});

import { campaignSendOneHandler } from "@/inngest/functions/campaign-send-one";

describe("campaign.send-one", () => {
  it("sends, marks SENT, writes SentMessage", async () => {
    const org = await prisma.organization.create({ data: { name: "O" } });
    const user = await prisma.user.create({ data: { orgId: org.id, email: `u${Date.now()}@x`, name: "Daniel" } });
    await prisma.linkedinSession.create({ data: { userId: user.id, encryptedCookie: "x", status: "ACTIVE" } as never });
    const tpl = await prisma.messageTemplate.create({ data: { ownerId: user.id, name: "T", body: "Hi" } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, linkedinUrn: "z", linkedinUrl: "x", fullName: "Z", lastSyncedAt: new Date() } });
    const camp = await prisma.campaign.create({ data: { ownerId: user.id, name: "c", channel: "LINKEDIN", templateId: tpl.id, status: "RUNNING" } });
    const rec = await prisma.campaignRecipient.create({ data: { campaignId: camp.id, contactId: contact.id, status: "PENDING", renderedBody: "Hello" } });

    await campaignSendOneHandler({ event: { data: { recipientId: rec.id } } });

    const after = await prisma.campaignRecipient.findUnique({ where: { id: rec.id }, include: { sentMessage: true } });
    expect(after?.status).toBe("SENT");
    expect(after?.sentMessage?.status).toBe("SENT");
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm run test -- campaign-send-one`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `inngest/functions/campaign-send-one.ts`:
```ts
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { LinkedinMcp, RateLimitError } from "@/lib/linkedin/mcp-client";
import { decryptCookie } from "@/lib/linkedin/cookie-crypto";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { publish } from "@/lib/linkedin/sse-bus";

const MAX_ATTEMPTS = 3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignSendOneHandler({ event }: any) {
  const { recipientId } = event.data as { recipientId: string };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: {
      campaign: { include: { owner: { include: { linkedinSession: true } } } },
      contact: true,
    },
  });
  if (!recipient || recipient.status !== "PENDING") return;
  if (recipient.campaign.status !== "RUNNING") return;

  const quota = await checkSendQuota(recipient.campaign.ownerId);
  if (!quota.ok) {
    await inngest.send({
      name: "campaign.send-one",
      data: { recipientId },
      ts: Date.now() + quota.retryAfterSec * 1000,
    });
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENDING", attemptCount: { increment: 1 } },
  });

  const session = recipient.campaign.owner.linkedinSession;
  if (!session) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "FAILED", errorMessage: "not_authenticated" },
    });
    await pauseCampaign(recipient.campaignId, "not_authenticated");
    return;
  }

  let mcp: LinkedinMcp | null = null;
  try {
    mcp = await LinkedinMcp.open(decryptCookie(session.encryptedCookie));
    await mcp.sendMessage(recipient.contact.linkedinUrn, recipient.renderedBody ?? "");

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
    publish(recipient.campaign.ownerId, { type: "campaign:sent", data: { recipientId, campaignId: recipient.campaignId } });
  } catch (err) {
    if (err instanceof RateLimitError) {
      await prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: { status: "PENDING" },
      });
      await pauseCampaign(recipient.campaignId, "rate_limit");
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const shouldRetry = recipient.attemptCount + 1 < MAX_ATTEMPTS;
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: shouldRetry ? "PENDING" : "FAILED", errorMessage: message },
    });
    if (shouldRetry) {
      const backoffSec = Math.pow(2, recipient.attemptCount) * 60;
      await inngest.send({ name: "campaign.send-one", data: { recipientId }, ts: Date.now() + backoffSec * 1000 });
    }
  } finally {
    await mcp?.close();
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
  }
}

async function pauseCampaign(campaignId: string, reason: string) {
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
  await prisma.auditEvent.create({
    data: { action: "campaign.paused", targetType: "Campaign", targetId: campaignId, metadata: { reason } } as never,
  });
}

export const campaignSendOne = inngest.createFunction(
  { id: "campaign-send-one", triggers: [{ event: "campaign.send-one" as const }] },
  campaignSendOneHandler
);
```

- [ ] **Step 4: Verify PASS**

Run: `npm run test -- campaign-send-one`
Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add inngest/functions/campaign-send-one.ts tests/campaigns/campaign-send-one.test.ts
git commit -m "feat(campaigns): add campaign.send-one Inngest function with throttling and retries"
```

---

## Task 8: `campaign.finalize` Inngest function

**Files:**
- Create: `inngest/functions/campaign-finalize.ts`
- Test: `tests/campaigns/campaign-finalize.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/campaigns/campaign-finalize.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_opts: unknown, fn: unknown) => fn, send: vi.fn() },
}));

import { campaignFinalizeHandler } from "@/inngest/functions/campaign-finalize";

describe("campaign.finalize", () => {
  it("marks campaign COMPLETED when no PENDING or SENDING remain", async () => {
    const org = await prisma.organization.create({ data: { name: "O" } });
    const user = await prisma.user.create({ data: { orgId: org.id, email: `u${Date.now()}@x`, name: "U" } });
    const tpl = await prisma.messageTemplate.create({ data: { ownerId: user.id, name: "T", body: "x" } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, linkedinUrn: "z", linkedinUrl: "x", fullName: "Z", lastSyncedAt: new Date() } });
    const camp = await prisma.campaign.create({ data: { ownerId: user.id, name: "c", channel: "LINKEDIN", templateId: tpl.id, status: "RUNNING" } });
    await prisma.campaignRecipient.create({ data: { campaignId: camp.id, contactId: contact.id, status: "SENT" } });

    await campaignFinalizeHandler({ event: { data: { campaignId: camp.id } } });

    const after = await prisma.campaign.findUnique({ where: { id: camp.id } });
    expect(after?.status).toBe("COMPLETED");
    expect(after?.completedAt).not.toBeNull();
  });

  it("does nothing while PENDING recipients remain", async () => {
    const org = await prisma.organization.create({ data: { name: "O" } });
    const user = await prisma.user.create({ data: { orgId: org.id, email: `u${Date.now()}@x`, name: "U" } });
    const tpl = await prisma.messageTemplate.create({ data: { ownerId: user.id, name: "T", body: "x" } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, linkedinUrn: "z", linkedinUrl: "x", fullName: "Z", lastSyncedAt: new Date() } });
    const camp = await prisma.campaign.create({ data: { ownerId: user.id, name: "c", channel: "LINKEDIN", templateId: tpl.id, status: "RUNNING" } });
    await prisma.campaignRecipient.create({ data: { campaignId: camp.id, contactId: contact.id, status: "PENDING" } });

    await campaignFinalizeHandler({ event: { data: { campaignId: camp.id } } });

    const after = await prisma.campaign.findUnique({ where: { id: camp.id } });
    expect(after?.status).toBe("RUNNING");
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm run test -- campaign-finalize`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `inngest/functions/campaign-finalize.ts`:
```ts
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignFinalizeHandler({ event }: any) {
  const { campaignId } = event.data as { campaignId: string };
  const pending = await prisma.campaignRecipient.count({
    where: { campaignId, status: { in: ["PENDING", "SENDING"] } },
  });
  if (pending > 0) return;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "RUNNING") return;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export const campaignFinalize = inngest.createFunction(
  { id: "campaign-finalize", triggers: [{ event: "campaign.finalize" as const }] },
  campaignFinalizeHandler
);
```

- [ ] **Step 4: Verify PASS**

Run: `npm run test -- campaign-finalize`
Expected: 2 pass.

- [ ] **Step 5: Register functions in Inngest route**

Open `app/api/inngest/route.ts`. Find the `functions: [...]` array. Add:
```ts
import { campaignStart } from "@/inngest/functions/campaign-start";
import { campaignSendOne } from "@/inngest/functions/campaign-send-one";
import { campaignFinalize } from "@/inngest/functions/campaign-finalize";

// inside functions array:
campaignStart, campaignSendOne, campaignFinalize,
```

- [ ] **Step 6: Commit**

```bash
git add inngest/functions/campaign-finalize.ts tests/campaigns/campaign-finalize.test.ts app/api/inngest/route.ts
git commit -m "feat(campaigns): add campaign.finalize and register Inngest functions"
```

---

## Task 9: API routes — create, list, detail

**Files:**
- Create: `app/api/campaigns/route.ts`
- Create: `app/api/campaigns/[id]/route.ts`
- Test: `tests/api/campaigns/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/campaigns/route.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: (handler: (ctx: { userId: string; orgId: string | null }) => unknown) =>
    () => handler({ userId: "TEST_USER", orgId: "TEST_ORG" }),
}));

import { POST, GET } from "@/app/api/campaigns/route";
import { prisma } from "@/lib/prisma";

describe("POST /api/campaigns", () => {
  it("creates a draft campaign with explicit contactIds", async () => {
    const org = await prisma.organization.create({ data: { id: "TEST_ORG", name: "O" } });
    const user = await prisma.user.create({ data: { id: "TEST_USER", orgId: org.id, email: `u${Date.now()}@x`, name: "U" } });
    const tpl = await prisma.messageTemplate.create({ data: { ownerId: user.id, name: "T", body: "Hi" } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, linkedinUrn: "a", linkedinUrl: "x", fullName: "A", lastSyncedAt: new Date() } });

    const req = new Request("http://x/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Test", templateId: tpl.id, contactIds: [contact.id] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.campaign.status).toBe("DRAFT");
    expect(json.campaign.channel).toBe("LINKEDIN");
  });
});

describe("GET /api/campaigns", () => {
  it("lists campaigns for the tenant only", async () => {
    const res = await GET(new Request("http://x/api/campaigns"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.campaigns)).toBe(true);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm run test -- api/campaigns`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/campaigns/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async ({ userId, orgId }, req: Request) => {
  const body = await req.json();
  const { name, templateId, contactIds, filter } = body as {
    name: string; templateId: string; contactIds?: string[]; filter?: unknown;
  };
  if (!name || !templateId) return NextResponse.json({ error: "name and templateId required" }, { status: 400 });
  const tpl = await prisma.messageTemplate.findFirst({ where: { id: templateId, ownerId: userId } });
  if (!tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const filterJson = contactIds ? { contactIds } : { filter };
  const campaign = await prisma.campaign.create({
    data: { ownerId: userId, orgId, name, channel: "LINKEDIN", templateId, status: "DRAFT", filterJson: filterJson as never },
  });
  return NextResponse.json({ campaign }, { status: 201 });
});

export const GET = withTenant(async ({ userId }) => {
  const campaigns = await prisma.campaign.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } }, _count: { select: { recipients: true } } },
  });
  return NextResponse.json({ campaigns });
});
```

Create `app/api/campaigns/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const GET = withTenant(async ({ userId }, _req: Request, ctx: { params: { id: string } }) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: ctx.params.id, ownerId: userId },
    include: {
      template: true,
      recipients: { include: { contact: { select: { fullName: true, currentTitle: true, currentCompany: true } } }, orderBy: { scheduledAt: "asc" } },
    },
  });
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ campaign });
});
```

- [ ] **Step 4: Verify PASS**

Run: `npm run test -- api/campaigns`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/campaigns/route.ts app/api/campaigns/[id]/route.ts tests/api/campaigns/route.test.ts
git commit -m "feat(campaigns): add create/list/detail API routes"
```

---

## Task 10: API routes — start / pause / resume / cancel

**Files:**
- Create: `app/api/campaigns/[id]/start/route.ts`
- Create: `app/api/campaigns/[id]/pause/route.ts`
- Create: `app/api/campaigns/[id]/resume/route.ts`
- Create: `app/api/campaigns/[id]/cancel/route.ts`
- Test: `tests/api/campaigns/lifecycle.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/api/campaigns/lifecycle.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

const sendMock = vi.fn();
vi.mock("@/inngest/client", () => ({ inngest: { send: sendMock } }));
vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: (h: (ctx: { userId: string; orgId: string | null }, req: Request, ctx2: unknown) => unknown) =>
    (req: Request, ctx2: unknown) => h({ userId: "U", orgId: "O" }, req, ctx2),
}));

import { POST as startRoute } from "@/app/api/campaigns/[id]/start/route";
import { POST as pauseRoute } from "@/app/api/campaigns/[id]/pause/route";
import { prisma } from "@/lib/prisma";

describe("campaign lifecycle routes", () => {
  it("start transitions DRAFT -> QUEUED and emits campaign.start", async () => {
    const org = await prisma.organization.create({ data: { id: "O", name: "O" } });
    const user = await prisma.user.create({ data: { id: "U", orgId: org.id, email: `u${Date.now()}@x`, name: "U" } });
    const tpl = await prisma.messageTemplate.create({ data: { ownerId: user.id, name: "T", body: "x" } });
    const camp = await prisma.campaign.create({ data: { ownerId: user.id, name: "c", channel: "LINKEDIN", templateId: tpl.id, status: "DRAFT" } });

    const res = await startRoute(new Request("http://x", { method: "POST" }), { params: { id: camp.id } });
    expect(res.status).toBe(200);
    const after = await prisma.campaign.findUnique({ where: { id: camp.id } });
    expect(after?.status).toBe("QUEUED");
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.start" }));
  });

  it("pause transitions RUNNING -> PAUSED", async () => {
    const org = await prisma.organization.create({ data: { id: "O", name: "O" } });
    const user = await prisma.user.create({ data: { id: "U", orgId: org.id, email: `u${Date.now()}@x`, name: "U" } });
    const tpl = await prisma.messageTemplate.create({ data: { ownerId: user.id, name: "T", body: "x" } });
    const camp = await prisma.campaign.create({ data: { ownerId: user.id, name: "c", channel: "LINKEDIN", templateId: tpl.id, status: "RUNNING" } });
    const res = await pauseRoute(new Request("http://x", { method: "POST" }), { params: { id: camp.id } });
    expect(res.status).toBe(200);
    const after = await prisma.campaign.findUnique({ where: { id: camp.id } });
    expect(after?.status).toBe("PAUSED");
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm run test -- campaigns/lifecycle`
Expected: FAIL.

- [ ] **Step 3: Implement start route**

Create `app/api/campaigns/[id]/start/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async ({ userId }, _req: Request, ctx: { params: { id: string } }) => {
  const camp = await prisma.campaign.findFirst({ where: { id: ctx.params.id, ownerId: userId } });
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (camp.status !== "DRAFT") return NextResponse.json({ error: `cannot start from ${camp.status}` }, { status: 409 });
  await prisma.campaign.update({ where: { id: camp.id }, data: { status: "QUEUED" } });
  await inngest.send({ name: "campaign.start", data: { campaignId: camp.id } });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 4: Implement pause/resume/cancel routes**

Create `app/api/campaigns/[id]/pause/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async ({ userId }, _req: Request, ctx: { params: { id: string } }) => {
  const camp = await prisma.campaign.findFirst({ where: { id: ctx.params.id, ownerId: userId } });
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (camp.status !== "RUNNING") return NextResponse.json({ error: `cannot pause from ${camp.status}` }, { status: 409 });
  await prisma.campaign.update({ where: { id: camp.id }, data: { status: "PAUSED" } });
  return NextResponse.json({ ok: true });
});
```

Create `app/api/campaigns/[id]/resume/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async ({ userId }, _req: Request, ctx: { params: { id: string } }) => {
  const camp = await prisma.campaign.findFirst({ where: { id: ctx.params.id, ownerId: userId } });
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (camp.status !== "PAUSED") return NextResponse.json({ error: `cannot resume from ${camp.status}` }, { status: 409 });
  await prisma.campaign.update({ where: { id: camp.id }, data: { status: "RUNNING" } });
  // Re-emit send-one for any still-PENDING recipients.
  const pending = await prisma.campaignRecipient.findMany({ where: { campaignId: camp.id, status: "PENDING" }, select: { id: true } });
  for (const r of pending) {
    await inngest.send({ name: "campaign.send-one", data: { recipientId: r.id } });
  }
  return NextResponse.json({ ok: true });
});
```

Create `app/api/campaigns/[id]/cancel/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async ({ userId }, _req: Request, ctx: { params: { id: string } }) => {
  const camp = await prisma.campaign.findFirst({ where: { id: ctx.params.id, ownerId: userId } });
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (["COMPLETED", "CANCELLED"].includes(camp.status)) {
    return NextResponse.json({ error: `cannot cancel from ${camp.status}` }, { status: 409 });
  }
  await prisma.campaign.update({ where: { id: camp.id }, data: { status: "CANCELLED", completedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 5: Verify PASS**

Run: `npm run test -- campaigns/lifecycle`
Expected: 2 pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/campaigns/[id]/ tests/api/campaigns/lifecycle.test.ts
git commit -m "feat(campaigns): add start/pause/resume/cancel API routes"
```

---

## Task 11: Campaigns list page

**Files:**
- Create: `app/(dashboard)/campaigns/page.tsx`
- Create: `app/(dashboard)/campaigns/campaigns-client.tsx`

- [ ] **Step 1: Implement server component**

Create `app/(dashboard)/campaigns/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { CampaignsClient } from "./campaigns-client";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const campaigns = await prisma.campaign.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } }, _count: { select: { recipients: true } } },
  });
  return <CampaignsClient campaigns={campaigns} />;
}
```

- [ ] **Step 2: Implement client list**

Create `app/(dashboard)/campaigns/campaigns-client.tsx`:
```tsx
"use client";
import Link from "next/link";

type Row = { id: string; name: string; status: string; createdAt: Date | string; template: { name: string }; _count: { recipients: number } };

export function CampaignsClient({ campaigns }: { campaigns: Row[] }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Campaigns</h1>
      <table className="mt-6 w-full text-sm text-slate-300">
        <thead className="text-left text-slate-500">
          <tr><th className="py-2">Name</th><th>Template</th><th>Recipients</th><th>Status</th><th>Created</th></tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t border-[#152030]">
              <td className="py-3"><Link href={`/campaigns/${c.id}`} className="text-[#1585ff] hover:underline">{c.name}</Link></td>
              <td>{c.template.name}</td>
              <td>{c._count.recipients}</td>
              <td><span className="rounded bg-[#152030] px-2 py-1 text-xs">{c.status}</span></td>
              <td>{new Date(c.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {campaigns.length === 0 && (
            <tr><td colSpan={5} className="py-12 text-center text-slate-500">No campaigns yet. Start one from the contacts page.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`
Navigate to `/campaigns`. Expected: empty state renders.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/campaigns/
git commit -m "feat(campaigns): add campaigns list page"
```

---

## Task 12: Campaign detail page with live recipient table

**Files:**
- Create: `app/(dashboard)/campaigns/[id]/page.tsx`
- Create: `app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx`

- [ ] **Step 1: Implement server component**

Create `app/(dashboard)/campaigns/[id]/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { CampaignDetailClient } from "./campaign-detail-client";

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      template: true,
      recipients: { include: { contact: { select: { fullName: true, currentTitle: true, currentCompany: true } } }, orderBy: { scheduledAt: "asc" } },
    },
  });
  if (!campaign) notFound();
  return <CampaignDetailClient initial={campaign} />;
}
```

- [ ] **Step 2: Implement client with SSE refresh**

Create `app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function CampaignDetailClient({ initial }: { initial: any }) {
  const [campaign, setCampaign] = useState(initial);

  useEffect(() => {
    const es = new EventSource("/api/linkedin/events");
    es.addEventListener("message", async (e) => {
      const payload = JSON.parse(e.data);
      if (payload.type === "campaign:sent" && payload.data.campaignId === campaign.id) {
        const res = await fetch(`/api/campaigns/${campaign.id}`);
        const json = await res.json();
        setCampaign(json.campaign);
      }
    });
    return () => es.close();
  }, [campaign.id]);

  const counts = campaign.recipients.reduce((acc: Record<string, number>, r: { status: string }) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
  }, {});

  async function action(verb: "pause" | "resume" | "cancel" | "start") {
    await fetch(`/api/campaigns/${campaign.id}/${verb}`, { method: "POST" });
    const res = await fetch(`/api/campaigns/${campaign.id}`);
    setCampaign((await res.json()).campaign);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{campaign.name}</h1>
          <p className="text-slate-500">Status: {campaign.status}</p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "DRAFT" && <button onClick={() => action("start")} className="rounded bg-[#1585ff] px-3 py-1.5 text-white">Start</button>}
          {campaign.status === "RUNNING" && <button onClick={() => action("pause")} className="rounded bg-[#f0a928] px-3 py-1.5 text-white">Pause</button>}
          {campaign.status === "PAUSED" && <button onClick={() => action("resume")} className="rounded bg-[#1585ff] px-3 py-1.5 text-white">Resume</button>}
          {!["COMPLETED", "CANCELLED"].includes(campaign.status) && <button onClick={() => action("cancel")} className="rounded border border-[#152030] px-3 py-1.5 text-slate-300">Cancel</button>}
        </div>
      </div>
      <div className="mt-6 flex gap-4 text-sm">
        {(["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"] as const).map((s) => (
          <div key={s} className="rounded bg-[#0a1422] px-3 py-2"><span className="text-slate-500">{s}: </span><span className="text-white">{counts[s] ?? 0}</span></div>
        ))}
      </div>
      <table className="mt-6 w-full text-sm text-slate-300">
        <thead className="text-left text-slate-500"><tr><th className="py-2">Contact</th><th>Title</th><th>Company</th><th>Status</th><th>Sent</th></tr></thead>
        <tbody>
          {campaign.recipients.map((r: { id: string; status: string; sentAt: string | null; contact: { fullName: string; currentTitle: string | null; currentCompany: string | null } }) => (
            <tr key={r.id} className="border-t border-[#152030]">
              <td className="py-2">{r.contact.fullName}</td>
              <td>{r.contact.currentTitle ?? "—"}</td>
              <td>{r.contact.currentCompany ?? "—"}</td>
              <td>{r.status}</td>
              <td>{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`. Create a campaign via API or DB and navigate to `/campaigns/[id]`. Expected: table renders, action buttons reflect status.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/campaigns/\[id\]/
git commit -m "feat(campaigns): add campaign detail page with live SSE updates"
```

---

## Task 13: New Campaign modal + entry from contacts page

**Files:**
- Create: `components/dashboard/new-campaign-modal.tsx`
- Modify: `components/dashboard/bulk-enrich-bar.tsx`

- [ ] **Step 1: Implement modal**

Create `components/dashboard/new-campaign-modal.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Template = { id: string; name: string; body: string };

export function NewCampaignModal({ open, onClose, contactIds }: { open: boolean; onClose: () => void; contactIds: string[] }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    fetch("/api/templates").then((r) => r.json()).then((j) => {
      setTemplates(j.templates ?? []);
      if (j.templates?.[0]) setTemplateId(j.templates[0].id);
    });
  }, [open]);

  if (!open) return null;
  const preview = templates.find((t) => t.id === templateId)?.body ?? "";

  async function submit() {
    setBusy(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, templateId, contactIds }),
    });
    const json = await res.json();
    if (res.ok) {
      await fetch(`/api/campaigns/${json.campaign.id}/start`, { method: "POST" });
      router.push(`/campaigns/${json.campaign.id}`);
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] rounded-lg border border-[#152030] bg-[#0a1422] p-6">
        <h2 className="text-lg font-semibold text-white">New campaign</h2>
        <p className="mt-1 text-sm text-slate-500">Sending to {contactIds.length} contact{contactIds.length === 1 ? "" : "s"} via LinkedIn.</p>
        <label className="mt-4 block text-xs uppercase text-slate-500">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded bg-[#07101c] px-3 py-2 text-white" />
        <label className="mt-4 block text-xs uppercase text-slate-500">Template</label>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 w-full rounded bg-[#07101c] px-3 py-2 text-white">
          {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
        <div className="mt-2 rounded bg-[#07101c] p-3 text-xs text-slate-400 whitespace-pre-wrap">{preview}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-[#152030] px-3 py-1.5 text-slate-300">Cancel</button>
          <button onClick={submit} disabled={!name || !templateId || busy} className="rounded bg-[#1585ff] px-3 py-1.5 text-white disabled:opacity-50">
            {busy ? "Starting…" : "Send Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire button into bulk-enrich-bar**

Open `components/dashboard/bulk-enrich-bar.tsx`. Locate the row of action buttons (Send Message, Enrich, Export CSV). Add a `Send Campaign` button next to `Send Message`:

```tsx
import { NewCampaignModal } from "./new-campaign-modal";
// add at top of component:
const [campaignOpen, setCampaignOpen] = useState(false);

// inside the button row JSX:
<button onClick={() => setCampaignOpen(true)} className="rounded bg-[#1585ff] px-3 py-1.5 text-white">Send Campaign</button>
<NewCampaignModal open={campaignOpen} onClose={() => setCampaignOpen(false)} contactIds={selectedIds} />
```

Use the existing `selectedIds` (or whatever name the file uses for the selected contact IDs — confirm by reading the file first).

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`. Set `LINKEDIN_SEND_MODE=mock`. Select contacts in the dashboard, click **Send Campaign**, fill modal, submit. Expected: redirected to campaign detail, recipients transition PENDING → SENT.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/new-campaign-modal.tsx components/dashboard/bulk-enrich-bar.tsx
git commit -m "feat(campaigns): add new-campaign modal and contacts-page entry point"
```

---

## Task 14: End-to-end Playwright smoke

**Files:**
- Create: `tests/e2e/campaigns.spec.ts`

- [ ] **Step 1: Write E2E test**

Create `tests/e2e/campaigns.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("create and run a LinkedIn campaign in mock mode", async ({ page }) => {
  // Assumes test fixtures: a logged-in user with at least 2 contacts and 1 template.
  // The Playwright config should set LINKEDIN_SEND_MODE=mock for the worker process.
  await page.goto("/dashboard");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Send Campaign" }).click();
  await page.getByLabel(/name/i).fill("E2E Test Campaign");
  await page.getByRole("button", { name: "Send Campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/[a-z0-9]+/);
  await expect(page.getByText(/RUNNING|COMPLETED/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/SENT: [12]/)).toBeVisible({ timeout: 60_000 });
});
```

- [ ] **Step 2: Run**

Run: `npx playwright test campaigns.spec.ts`
Expected: passes against a dev server with `LINKEDIN_SEND_MODE=mock`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/campaigns.spec.ts
git commit -m "test(campaigns): add e2e smoke for create+run in mock mode"
```

---

## Final verification

- [ ] Run full test suite: `npm run test`
- [ ] Run typecheck: `npm run typecheck` (or `npx tsc --noEmit`)
- [ ] Run lint: `npm run lint`
- [ ] Manual smoke with `LINKEDIN_SEND_MODE=mock`: contacts → select → Send Campaign → see status updates → COMPLETED
- [ ] Manual smoke against a **test LinkedIn account** (NOT your production one): one campaign, two recipients you control, verify the messages actually arrive.

---

## Spec coverage check

| Spec section                          | Covered by                                 |
|---------------------------------------|--------------------------------------------|
| User flow (filter → modal → run)      | Tasks 9, 11, 12, 13                        |
| Data model (Campaign, Recipient)      | Task 1                                     |
| LinkedIn send module                  | Reuses existing `LinkedinMcp.sendMessage`; Task 5 adds mock gate |
| Throttling (20/hr, 80/24h, jitter)    | Tasks 3, 7                                 |
| Inngest fan-out                       | Tasks 6, 7, 8                              |
| Template variables (recipient+sender) | Task 2                                     |
| API surface                           | Tasks 9, 10                                |
| UI                                    | Tasks 11, 12, 13                           |
| Failure modes & retries               | Task 7 (retry loop, pauseCampaign)         |
| Audit logging                         | Task 7 (`pauseCampaign` writes AuditEvent) |
| Observability counters                | Task 12 (counts computed client-side)      |
