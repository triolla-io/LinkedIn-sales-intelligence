# Evergreen Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot Campaign module with an evergreen multi-channel drip campaign backed by the existing Sequences infrastructure.

**Architecture:** Reuse existing Sequence/SequenceStep/SequenceEnrollment DB tables and Inngest functions as-is. Build a new Campaign builder UI and manual-enrollment API on top. Retire old Campaign Inngest functions and `/api/campaigns` routes.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript, Tailwind CSS, Inngest, Vitest

---

## File Map

| Action | File |
|---|---|
| Modify | `prisma/schema.prisma` |
| Create | `prisma/migrations/<ts>_evergreen_campaigns/migration.sql` |
| Modify | `lib/sequences/helpers.ts` |
| Modify | `inngest/functions/sequence-start.ts` |
| Modify | `inngest/functions/sequence-tick.ts` |
| Modify | `app/api/sequences/route.ts` |
| Create | `app/api/sequences/[id]/enrollments/route.ts` |
| Create | `app/api/sequences/[id]/update/route.ts` |
| Create | `app/(dashboard)/campaigns/new/page.tsx` |
| Create | `app/(dashboard)/campaigns/new/campaign-builder.tsx` |
| Create | `app/(dashboard)/campaigns/[id]/edit/page.tsx` |
| Modify | `app/(dashboard)/campaigns/campaigns-client.tsx` |
| Modify | `app/(dashboard)/campaigns/[id]/page.tsx` |
| Modify | `app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx` |
| Modify | `app/api/inngest/route.ts` |
| Delete | `app/api/campaigns/route.ts` |
| Delete | `app/api/campaigns/[id]/route.ts` |
| Delete | `inngest/functions/campaign-start.ts` |
| Delete | `inngest/functions/campaign-send-one.ts` |
| Delete | `inngest/functions/campaign-send-email.ts` |
| Delete | `inngest/functions/campaign-send-whatsapp.ts` |
| Delete | `inngest/functions/campaign-finalize.ts` |
| Create | `tests/unit/sequences-enroll.test.ts` |

---

## Task 1: Schema — optional contactListId + sendHourEnd

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_evergreen_campaigns/migration.sql`

- [ ] **Step 1: Update schema.prisma**

In `prisma/schema.prisma`, find the `Sequence` model and make `contactListId` optional:

```prisma
model Sequence {
  id            String         @id @default(cuid())
  ownerId       String
  orgId         String?
  name          String
  contactListId String?          // was: String (non-nullable)
  status        SequenceStatus @default(DRAFT)
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  owner       User                  @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  contactList ContactList?          @relation(fields: [contactListId], references: [id], onDelete: SetNull)  // was: ContactList (non-nullable, Cascade)
  steps       SequenceStep[]
  enrollments SequenceEnrollment[]

  @@index([ownerId, status])
}
```

In the same file, add `sendHourEnd` to `SequenceStep`:

```prisma
model SequenceStep {
  id          String          @id @default(cuid())
  sequenceId  String
  stepNumber  Int
  dayOffset   Int
  sendHour    Int             @default(9)
  sendMinute  Int             @default(0)
  sendHourEnd Int?                               // NEW — end of send window (hour, 0-23)
  channel     CampaignChannel
  templateId  String
  subject     String?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  sequence   Sequence                @relation(fields: [sequenceId], references: [id], onDelete: Cascade)
  template   MessageTemplate         @relation(fields: [templateId], references: [id])
  executions SequenceStepExecution[]

  @@unique([sequenceId, stepNumber])
  @@index([sequenceId])
}
```

- [ ] **Step 2: Create migration**

```bash
npx prisma migrate dev --name evergreen_campaigns
```

Expected output includes: `Your database is now in sync with your schema.`

If the migration file isn't auto-created cleanly, create `prisma/migrations/<timestamp>_evergreen_campaigns/migration.sql`:

```sql
-- AlterTable: make contactListId nullable
ALTER TABLE "Sequence" ALTER COLUMN "contactListId" DROP NOT NULL;

-- AlterTable: add sendHourEnd
ALTER TABLE "SequenceStep" ADD COLUMN "sendHourEnd" INTEGER;

-- Update foreign key to SET NULL on delete (Prisma handles via migrate, but include explicitly)
ALTER TABLE "Sequence" DROP CONSTRAINT IF EXISTS "Sequence_contactListId_fkey";
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_contactListId_fkey"
  FOREIGN KEY ("contactListId") REFERENCES "ContactList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: make contactListId optional, add sendHourEnd to SequenceStep"
```

---

## Task 2: Update helpers.ts — add sendHourEnd to ParsedStep

**Files:**
- Modify: `lib/sequences/helpers.ts`

- [ ] **Step 1: Add sendHourEnd to ParsedStep type and parseSteps**

In `lib/sequences/helpers.ts`, update `ParsedStep` and `parseSteps`:

```typescript
export type ParsedStep = {
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP" | "LINKEDIN";
  templateId: string;
  subject: string | null;
  sendHour: number;
  sendMinute: number;
  sendHourEnd: number | null;  // NEW
};

export function parseSteps(input: unknown): ParsedStep[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const steps: ParsedStep[] = [];
  const seenNumbers = new Set<number>();
  let prevOffset: number | null = null;
  for (const raw of input as Record<string, unknown>[]) {
    if (typeof raw.stepNumber !== "number" || typeof raw.dayOffset !== "number") return null;
    if (!Number.isInteger(raw.dayOffset) || raw.dayOffset < 0) return null;
    if (typeof raw.templateId !== "string" || !raw.templateId) return null;
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP" && raw.channel !== "LINKEDIN") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (prevOffset !== null && raw.dayOffset < prevOffset) return null;
    const rawHour = raw.sendHour ?? 9;
    const rawMinute = raw.sendMinute ?? 0;
    const rawHourEnd = raw.sendHourEnd ?? null;
    if (!Number.isInteger(rawHour) || (rawHour as number) < 0 || (rawHour as number) > 23) return null;
    if (!Number.isInteger(rawMinute) || (rawMinute as number) < 0 || (rawMinute as number) > 59) return null;
    if (rawHourEnd !== null) {
      if (!Number.isInteger(rawHourEnd) || (rawHourEnd as number) < 0 || (rawHourEnd as number) > 23) return null;
      if ((rawHourEnd as number) <= (rawHour as number)) return null;
    }
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel as "EMAIL" | "WHATSAPP" | "LINKEDIN",
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
      sendHour: rawHour as number,
      sendMinute: rawMinute as number,
      sendHourEnd: rawHourEnd as number | null,
    });
  }
  return steps;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/sequences/helpers.ts
git commit -m "feat: add sendHourEnd to ParsedStep and parseSteps"
```

---

## Task 3: Guard null contactListId in sequence-start and sequence-tick

**Files:**
- Modify: `inngest/functions/sequence-start.ts`
- Modify: `inngest/functions/sequence-tick.ts`

- [ ] **Step 1: Update sequence-start.ts**

In `inngest/functions/sequence-start.ts`, wrap the list-member enrollment in a null guard:

```typescript
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";

export const sequenceStart = inngest.createFunction(
  { id: "sequence-start", triggers: [{ event: "sequence.start" as const }] },
  async ({ event }) => {
    const { sequenceId } = event.data as { sequenceId: string };

    const sequence = await prisma.sequence.findUnique({
      where: { id: sequenceId },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });
    if (!sequence) throw new Error(`Sequence ${sequenceId} not found`);
    if (sequence.status !== "QUEUED") return;

    const now = new Date();
    await prisma.sequence.update({
      where: { id: sequenceId },
      data: { status: "ACTIVE", startedAt: now },
    });

    const firstStep = sequence.steps[0];
    if (!firstStep) return;

    // Only auto-enroll from list if one is linked
    if (!sequence.contactListId) return;

    const members = await prisma.contactListMember.findMany({
      where: { listId: sequence.contactListId },
      select: { contactId: true },
    });

    for (const member of members) {
      const enrollment = await prisma.sequenceEnrollment.create({
        data: { sequenceId, contactId: member.contactId, status: "ACTIVE" },
      });
      const scheduledAt = computeScheduledAt(
        enrollment.enrolledAt,
        firstStep.dayOffset,
        firstStep.sendHour,
        firstStep.sendMinute
      );
      await prisma.sequenceStepExecution.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: firstStep.id,
          status: "PENDING",
          scheduledAt,
        },
      });
    }
  }
);
```

- [ ] **Step 2: Update sequence-tick.ts**

In `inngest/functions/sequence-tick.ts`, wrap the list-member enrollment block with a null guard:

```typescript
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";

export const sequenceTick = inngest.createFunction(
  { id: "sequence-tick", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const now = new Date();

    const activeSequences = await prisma.sequence.findMany({
      where: { status: "ACTIVE" },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });

    for (const sequence of activeSequences) {
      // 1. Enroll new list members (only if a list is linked)
      if (sequence.contactListId) {
        const existingEnrollments = await prisma.sequenceEnrollment.findMany({
          where: { sequenceId: sequence.id },
          select: { contactId: true },
        });
        const enrolledIds = new Set(existingEnrollments.map((e) => e.contactId));

        const allMembers = await prisma.contactListMember.findMany({
          where: { listId: sequence.contactListId },
          select: { contactId: true },
        });

        const firstStep = sequence.steps[0];
        const newMembers = allMembers.filter((m) => !enrolledIds.has(m.contactId));
        if (newMembers.length > 0 && firstStep) {
          await prisma.sequenceEnrollment.createMany({
            data: newMembers.map((m) => ({
              sequenceId: sequence.id,
              contactId: m.contactId,
              status: "ACTIVE" as const,
            })),
            skipDuplicates: true,
          });

          const newEnrollments = await prisma.sequenceEnrollment.findMany({
            where: {
              sequenceId: sequence.id,
              contactId: { in: newMembers.map((m) => m.contactId) },
            },
            select: { id: true, enrolledAt: true },
          });

          await prisma.sequenceStepExecution.createMany({
            data: newEnrollments.map((enr) => ({
              enrollmentId: enr.id,
              stepId: firstStep.id,
              status: "PENDING" as const,
              scheduledAt: computeScheduledAt(enr.enrolledAt, firstStep.dayOffset, firstStep.sendHour, firstStep.sendMinute),
            })),
            skipDuplicates: true,
          });
        }
      }

      // 2. Dispatch due PENDING executions
      const dueExecutions = await prisma.sequenceStepExecution.findMany({
        where: {
          status: "PENDING",
          scheduledAt: { lte: now },
          enrollment: { sequenceId: sequence.id, status: "ACTIVE" },
        },
        select: { id: true },
      });

      for (const exec of dueExecutions) {
        await inngest.send({
          name: "sequence.send-execution" as const,
          data: { executionId: exec.id },
        });
      }

      // 3. Recover executions stuck in SENDING for more than 10 minutes
      const stuckThreshold = new Date(now.getTime() - 10 * 60 * 1000);
      await prisma.sequenceStepExecution.updateMany({
        where: {
          status: "SENDING",
          updatedAt: { lt: stuckThreshold },
          enrollment: { sequenceId: sequence.id, status: "ACTIVE" },
        },
        data: { status: "PENDING", errorMessage: "recovered_from_stuck_sending" },
      });
    }
  }
);
```

- [ ] **Step 3: Commit**

```bash
git add inngest/functions/sequence-start.ts inngest/functions/sequence-tick.ts
git commit -m "feat: guard null contactListId in sequence-start and sequence-tick"
```

---

## Task 4: Update POST /api/sequences — optional contactListId

**Files:**
- Modify: `app/api/sequences/route.ts`

- [ ] **Step 1: Read the current file**

Read `app/api/sequences/route.ts` to see the full handler before editing.

- [ ] **Step 2: Make contactListId optional in POST**

In `app/api/sequences/route.ts`, find the POST handler. The body parsing currently requires `contactListId`. Change it to be optional. The key change is in the body validation and the `prisma.sequence.create` call:

```typescript
// POST handler body parsing (replace existing validation):
const { name, contactListId, steps: rawSteps } = body as {
  name?: unknown;
  contactListId?: unknown;
  steps?: unknown;
};

if (typeof name !== "string" || !name.trim()) {
  return NextResponse.json({ error: "name required" }, { status: 400 });
}

// contactListId is optional — validate only if provided
if (contactListId !== undefined && contactListId !== null && typeof contactListId !== "string") {
  return NextResponse.json({ error: "invalid contactListId" }, { status: 400 });
}

const steps = parseSteps(rawSteps);
if (!steps) {
  return NextResponse.json({ error: "invalid steps" }, { status: 400 });
}

// In prisma.sequence.create:
const sequence = await prisma.sequence.create({
  data: {
    ownerId: ctx.effectiveUserId,
    orgId: ctx.org?.id ?? null,
    name: name.trim(),
    contactListId: (contactListId as string | null | undefined) ?? null,  // nullable
    steps: {
      create: steps.map((s) => ({
        stepNumber: s.stepNumber,
        dayOffset: s.dayOffset,
        channel: s.channel,
        templateId: s.templateId,
        subject: s.subject,
        sendHour: s.sendHour,
        sendMinute: s.sendMinute,
        sendHourEnd: s.sendHourEnd ?? null,
      })),
    },
  },
  include: { steps: true },
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors on `app/api/sequences/route.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/api/sequences/route.ts
git commit -m "feat: make contactListId optional in POST /api/sequences"
```

---

## Task 5: New PATCH /api/sequences/[id]/update — edit campaign

**Files:**
- Create: `app/api/sequences/[id]/update/route.ts`

This endpoint updates name, contactListId, and steps. Steps can only be changed while the sequence is DRAFT.

- [ ] **Step 1: Create the file**

Create `app/api/sequences/[id]/update/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { parseSteps } from "@/lib/sequences/helpers";

export const PATCH = withTenant(
  async (req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await req.json();
    const { name, contactListId, steps: rawSteps } = body as {
      name?: unknown;
      contactListId?: unknown;
      steps?: unknown;
    };

    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });

    const updateData: Record<string, unknown> = {};

    if (typeof name === "string" && name.trim()) {
      updateData.name = name.trim();
    }
    if (contactListId !== undefined) {
      updateData.contactListId = (contactListId as string | null) ?? null;
    }

    await prisma.sequence.update({ where: { id }, data: updateData });

    // Steps can only be replaced on DRAFT sequences
    if (rawSteps !== undefined) {
      if (sequence.status !== "DRAFT") {
        return NextResponse.json(
          { error: "steps can only be changed on DRAFT campaigns" },
          { status: 409 }
        );
      }
      const steps = parseSteps(rawSteps);
      if (!steps) return NextResponse.json({ error: "invalid steps" }, { status: 400 });

      await prisma.sequenceStep.deleteMany({ where: { sequenceId: id } });
      await prisma.sequenceStep.createMany({
        data: steps.map((s) => ({
          sequenceId: id,
          stepNumber: s.stepNumber,
          dayOffset: s.dayOffset,
          channel: s.channel,
          templateId: s.templateId,
          subject: s.subject,
          sendHour: s.sendHour,
          sendMinute: s.sendMinute,
          sendHourEnd: s.sendHourEnd ?? null,
        })),
      });
    }

    const updated = await prisma.sequence.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });
    return NextResponse.json({ sequence: updated });
  }
);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/sequences/[id]/update/route.ts
git commit -m "feat: add PATCH /api/sequences/[id]/update for campaign editing"
```

---

## Task 6: New POST /api/sequences/[id]/enrollments — manual enrollment

**Files:**
- Create: `app/api/sequences/[id]/enrollments/route.ts`
- Create: `tests/unit/sequences-enroll.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sequences-enroll.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockFindMany = vi.hoisted(() => vi.fn());
const mockCreateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "user1", orgId: null, role: "SALESPERSON", org: null }) },
    sequence: { findFirst: mockFindFirst },
    sequenceEnrollment: { createMany: mockCreateMany, findMany: mockFindMany },
    sequenceStepExecution: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/sequences/seq1/enrollments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user1" } });
});

describe("POST /api/sequences/[id]/enrollments", () => {
  it("returns 404 when sequence not found", async () => {
    mockFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/sequences/[id]/enrollments/route");
    const res = await POST(makeReq({ contactIds: ["c1"] }), {
      params: Promise.resolve({ id: "seq1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when sequence has no steps", async () => {
    mockFindFirst.mockResolvedValue({ id: "seq1", ownerId: "user1", steps: [] });
    const { POST } = await import("@/app/api/sequences/[id]/enrollments/route");
    const res = await POST(makeReq({ contactIds: ["c1"] }), {
      params: Promise.resolve({ id: "seq1" }),
    });
    expect(res.status).toBe(400);
  });

  it("enrolls contacts and returns counts", async () => {
    const firstStep = { id: "step1", dayOffset: 0, sendHour: 9, sendMinute: 0 };
    mockFindFirst.mockResolvedValue({ id: "seq1", ownerId: "user1", steps: [firstStep] });
    mockCreateMany.mockResolvedValue({ count: 1 });
    mockFindMany.mockResolvedValue([
      { id: "enr1", enrolledAt: new Date("2026-06-02T09:00:00Z"), executions: [] },
    ]);
    const { POST } = await import("@/app/api/sequences/[id]/enrollments/route");
    const res = await POST(makeReq({ contactIds: ["c1"] }), {
      params: Promise.resolve({ id: "seq1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enrolled).toBe(1);
    expect(json.skipped).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/sequences-enroll.test.ts
```

Expected: FAIL with import error (file doesn't exist yet).

- [ ] **Step 3: Create the endpoint**

Create `app/api/sequences/[id]/enrollments/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";

export const POST = withTenant(
  async (req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await req.json();
    const { contactIds } = body as { contactIds?: unknown };

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json({ error: "contactIds required" }, { status: 400 });
    }

    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      include: { steps: { orderBy: { stepNumber: "asc" }, take: 1 } },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });

    const firstStep = sequence.steps[0];
    if (!firstStep) return NextResponse.json({ error: "no steps configured" }, { status: 400 });

    await prisma.sequenceEnrollment.createMany({
      data: (contactIds as string[]).map((contactId) => ({
        sequenceId: id,
        contactId,
        status: "ACTIVE" as const,
      })),
      skipDuplicates: true,
    });

    const enrollments = await prisma.sequenceEnrollment.findMany({
      where: { sequenceId: id, contactId: { in: contactIds as string[] } },
      select: {
        id: true,
        enrolledAt: true,
        executions: { select: { id: true }, take: 1 },
      },
    });

    const newEnrollments = enrollments.filter((e) => e.executions.length === 0);
    if (newEnrollments.length > 0) {
      await prisma.sequenceStepExecution.createMany({
        data: newEnrollments.map((enr) => ({
          enrollmentId: enr.id,
          stepId: firstStep.id,
          status: "PENDING" as const,
          scheduledAt: computeScheduledAt(
            enr.enrolledAt,
            firstStep.dayOffset,
            firstStep.sendHour,
            firstStep.sendMinute
          ),
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({
      enrolled: newEnrollments.length,
      skipped: (contactIds as string[]).length - newEnrollments.length,
    });
  }
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/sequences-enroll.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/sequences/[id]/enrollments/route.ts tests/unit/sequences-enroll.test.ts
git commit -m "feat: add POST /api/sequences/[id]/enrollments for manual enrollment"
```

---

## Task 7: Campaign builder component

**Files:**
- Create: `app/(dashboard)/campaigns/new/campaign-builder.tsx`

This is a shared client component used by both the new-campaign page and edit-campaign page.

- [ ] **Step 1: Create the builder component**

Create `app/(dashboard)/campaigns/new/campaign-builder.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";

type Channel = "EMAIL" | "WHATSAPP" | "LINKEDIN";

type Template = {
  id: string;
  name: string;
  channel: Channel;
};

type ContactList = {
  id: string;
  name: string;
};

type StepDraft = {
  localId: number;
  stepNumber: number;
  channel: Channel;
  templateId: string;
  dayOffset: number;
  sendHour: number;
  sendHourEnd: number | null;
  subject: string;
};

type Props = {
  templates: Template[];
  contactLists: ContactList[];
  initialName?: string;
  initialContactListId?: string | null;
  initialSteps?: StepDraft[];
  sequenceId?: string; // if editing
  isActive?: boolean;  // editing an active campaign — steps are read-only
};

const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  LINKEDIN: "LinkedIn",
};

let nextLocalId = 1;
function newStep(stepNumber: number): StepDraft {
  return {
    localId: nextLocalId++,
    stepNumber,
    channel: "EMAIL",
    templateId: "",
    dayOffset: 0,
    sendHour: 9,
    sendHourEnd: 18,
    subject: "",
  };
}

export default function CampaignBuilder({
  templates,
  contactLists,
  initialName = "",
  initialContactListId = null,
  initialSteps,
  sequenceId,
  isActive = false,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [contactListId, setContactListId] = useState<string>(initialContactListId ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(
    initialSteps ?? [newStep(1)]
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateStep(localId: number, patch: Partial<StepDraft>) {
    setSteps((prev) =>
      prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s))
    );
  }

  function addStep() {
    const maxOffset = steps.length > 0 ? steps[steps.length - 1].dayOffset : 0;
    setSteps((prev) => [
      ...prev,
      newStep(prev.length + 1),
    ]);
    // update last added step dayOffset to be > previous
    setSteps((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      updated[updated.length - 1] = { ...last, dayOffset: maxOffset + 1 };
      return updated;
    });
  }

  function removeStep(localId: number) {
    setSteps((prev) => {
      const filtered = prev.filter((s) => s.localId !== localId);
      return filtered.map((s, i) => ({ ...s, stepNumber: i + 1 }));
    });
  }

  function moveStep(localId: number, direction: "up" | "down") {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.localId === localId);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next.map((s, i) => ({ ...s, stepNumber: i + 1 }));
    });
  }

  function validate(): string | null {
    if (!name.trim()) return "נא להזין שם קמפיין";
    if (steps.length === 0) return "נא להוסיף לפחות שלב אחד";
    for (const step of steps) {
      if (!step.templateId) return `בחר תבנית לשלב ${step.stepNumber}`;
      if (step.channel === "EMAIL" && !step.subject.trim())
        return `נא להזין נושא לשלב ${step.stepNumber} (Email)`;
      if (step.sendHourEnd !== null && step.sendHourEnd <= step.sendHour)
        return `שעת סיום חייבת להיות אחרי שעת התחלה בשלב ${step.stepNumber}`;
    }
    let prevOffset = -1;
    for (const step of steps) {
      if (step.dayOffset < prevOffset)
        return `dayOffset בשלב ${step.stepNumber} חייב להיות גדול או שווה לשלב הקודם`;
      prevOffset = step.dayOffset;
    }
    return null;
  }

  function buildPayload() {
    return {
      name: name.trim(),
      contactListId: contactListId || null,
      steps: steps.map((s) => ({
        stepNumber: s.stepNumber,
        channel: s.channel,
        templateId: s.templateId,
        dayOffset: s.dayOffset,
        sendHour: s.sendHour,
        sendMinute: 0,
        sendHourEnd: s.sendHourEnd,
        subject: s.subject || null,
      })),
    };
  }

  async function save(andActivate: boolean) {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError(null);
    setSaving(true);

    try {
      let id = sequenceId;
      if (!id) {
        // Create new
        const res = await fetch("/api/sequences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? "שגיאה בשמירה");
          return;
        }
        const json = await res.json();
        id = (json as { sequence: { id: string } }).sequence.id;
      } else {
        // Update existing
        const res = await fetch(`/api/sequences/${id}/update`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? "שגיאה בעדכון");
          return;
        }
      }

      if (andActivate) {
        const res = await fetch(`/api/sequences/${id}/start`, { method: "POST" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? "שגיאה בהפעלה");
          return;
        }
      }

      router.push(andActivate ? `/campaigns/${id}` : `/campaigns`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const templatesForChannel = (channel: Channel) =>
    templates.filter((t) => t.channel === channel);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">
        {sequenceId ? "עריכת קמפיין" : "קמפיין חדש"}
      </h1>

      {/* Area 1: Campaign details */}
      <section className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">שם הקמפיין *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמא: Outreach Q3"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            רשימה מקושרת <span className="text-gray-400">(אופציונלי)</span>
          </label>
          <select
            value={contactListId}
            onChange={(e) => setContactListId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">ללא רשימה</option>
            {contactLists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            אנשי קשר שיתווספו לרשימה יירשמו אוטומטית לקמפיין
          </p>
        </div>
      </section>

      {/* Area 2: Steps builder */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-800">שלבים</h2>

        {isActive && (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            הקמפיין פעיל — לא ניתן לשנות שלבים. ניתן לשנות שם ורשימה בלבד.
          </p>
        )}

        {steps.map((step, idx) => {
          const channelTemplates = templatesForChannel(step.channel);
          return (
            <div key={step.localId} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-white">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">שלב {step.stepNumber}</span>
                {!isActive && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveStep(step.localId, "up")}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      onClick={() => moveStep(step.localId, "down")}
                      disabled={idx === steps.length - 1}
                      className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ChevronDown size={16} />
                    </button>
                    {steps.length > 1 && (
                      <button
                        onClick={() => removeStep(step.localId)}
                        className="p-1 rounded hover:bg-red-50 text-red-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ערוץ</label>
                  <select
                    value={step.channel}
                    disabled={isActive}
                    onChange={(e) =>
                      updateStep(step.localId, {
                        channel: e.target.value as Channel,
                        templateId: "",
                        subject: "",
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(CHANNEL_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">תבנית *</label>
                  <select
                    value={step.templateId}
                    disabled={isActive}
                    onChange={(e) => updateStep(step.localId, { templateId: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">בחר תבנית</option>
                    {channelTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {step.channel === "EMAIL" && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">נושא המייל *</label>
                  <input
                    type="text"
                    value={step.subject}
                    disabled={isActive}
                    onChange={(e) => updateStep(step.localId, { subject: e.target.value })}
                    placeholder="נושא"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">אחרי כמה ימים</label>
                  <input
                    type="number"
                    min={0}
                    value={step.dayOffset}
                    disabled={isActive}
                    onChange={(e) =>
                      updateStep(step.localId, { dayOffset: parseInt(e.target.value) || 0 })
                    }
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">שעת התחלה</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={step.sendHour}
                    disabled={isActive}
                    onChange={(e) =>
                      updateStep(step.localId, { sendHour: parseInt(e.target.value) || 0 })
                    }
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">שעת סיום</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={step.sendHourEnd ?? ""}
                    disabled={isActive}
                    onChange={(e) =>
                      updateStep(step.localId, {
                        sendHourEnd: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {!isActive && (
          <button
            onClick={addStep}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus size={16} />
            הוסף שלב
          </button>
        )}
      </section>

      {/* Area 3: Actions */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? "שומר..." : "שמור כטיוטה"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={saving || (!!sequenceId && isActive)}
          className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "מפעיל..." : sequenceId && !isActive ? "עדכן והפעל" : "שמור והפעל"}
        </button>
        <button
          onClick={() => router.back()}
          disabled={saving}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/campaigns/new/campaign-builder.tsx
git commit -m "feat: add campaign builder client component"
```

---

## Task 8: /campaigns/new page

**Files:**
- Create: `app/(dashboard)/campaigns/new/page.tsx`

- [ ] **Step 1: Create the server page**

Create `app/(dashboard)/campaigns/new/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CampaignBuilder from "./campaign-builder";

export default async function NewCampaignPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const userId = session.user.id;

  const [contactLists, templates] = await Promise.all([
    prisma.contactList.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, channel: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <CampaignBuilder
      contactLists={contactLists}
      templates={templates as { id: string; name: string; channel: "EMAIL" | "WHATSAPP" | "LINKEDIN" }[]}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/campaigns/new/page.tsx
git commit -m "feat: add /campaigns/new page"
```

---

## Task 9: /campaigns/[id]/edit page

**Files:**
- Create: `app/(dashboard)/campaigns/[id]/edit/page.tsx`

- [ ] **Step 1: Create the server page**

Create `app/(dashboard)/campaigns/[id]/edit/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CampaignBuilder from "../../new/campaign-builder";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const { id } = await params;
  const userId = session.user.id;

  const [sequence, contactLists, templates] = await Promise.all([
    prisma.sequence.findFirst({
      where: { id, ownerId: userId },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    }),
    prisma.contactList.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, channel: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!sequence) notFound();

  const isActive = !["DRAFT", "QUEUED"].includes(sequence.status);

  const initialSteps = sequence.steps.map((s, i) => ({
    localId: i + 1,
    stepNumber: s.stepNumber,
    channel: s.channel as "EMAIL" | "WHATSAPP" | "LINKEDIN",
    templateId: s.templateId,
    dayOffset: s.dayOffset,
    sendHour: s.sendHour,
    sendHourEnd: (s as { sendHourEnd?: number | null }).sendHourEnd ?? null,
    subject: s.subject ?? "",
  }));

  return (
    <CampaignBuilder
      contactLists={contactLists}
      templates={templates as { id: string; name: string; channel: "EMAIL" | "WHATSAPP" | "LINKEDIN" }[]}
      initialName={sequence.name}
      initialContactListId={sequence.contactListId}
      initialSteps={initialSteps}
      sequenceId={sequence.id}
      isActive={isActive}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/campaigns/[id]/edit/page.tsx
git commit -m "feat: add /campaigns/[id]/edit page"
```

---

## Task 10: Update campaigns list — replace modal with builder link

**Files:**
- Modify: `app/(dashboard)/campaigns/campaigns-client.tsx`

- [ ] **Step 1: Read the current file**

Read `app/(dashboard)/campaigns/campaigns-client.tsx` to find the "New Campaign" button and modal.

- [ ] **Step 2: Replace modal with router link**

Find the "New Campaign" button (likely renders a `<button>` that opens a modal state). Replace it with a Next.js `<Link>` to `/campaigns/new`:

```tsx
// Add to imports at top:
import Link from "next/link";

// Replace the "New Campaign" button (wherever it appears in the JSX):
<Link
  href="/campaigns/new"
  className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
>
  + קמפיין חדש
</Link>
```

Also remove:
- Any modal state (`useState` for `showNewCampaignModal` or similar)
- The modal component and its contents (form fields for creating a campaign inline)
- Any `handleCreateCampaign` function that called `POST /api/sequences`

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/campaigns/campaigns-client.tsx
git commit -m "feat: replace new-campaign modal with link to /campaigns/new"
```

---

## Task 11: Update campaign detail — metric cards, manual enrollment, next step column, Edit link

**Files:**
- Modify: `app/(dashboard)/campaigns/[id]/page.tsx`
- Modify: `app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx`

- [ ] **Step 1: Read both files in full**

Read `app/(dashboard)/campaigns/[id]/page.tsx` and `app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx` before editing.

- [ ] **Step 2: Update page.tsx — pass contacts for search + add contactId to enrollment select**

In `app/(dashboard)/campaigns/[id]/page.tsx`:

1. Add a fetch for contacts:

```typescript
// Add alongside existing fetches:
const contacts = await prisma.contact.findMany({
  where: { ownerId: userId },
  select: { id: true, fullName: true, currentTitle: true, currentCompany: true },
  orderBy: { fullName: "asc" },
  take: 500,  // reasonable cap for the search modal
});
```

2. In the existing enrollments query, make sure `contactId` is selected at the enrollment level (not just inside the contact relation), so we can build the excluded-IDs set client-side:

```typescript
// In the sequence query's enrollments include, add contactId to the select:
enrollments: {
  select: {
    id: true,
    contactId: true,   // ADD THIS
    status: true,
    enrolledAt: true,
    contact: {
      select: { fullName: true, currentTitle: true, currentCompany: true },
    },
    executions: {
      select: { status: true, sentAt: true, scheduledAt: true, step: { select: { stepNumber: true, channel: true } } },
    },
  },
},
```

3. Pass `contacts` as a prop to `<CampaignDetailClient ... contacts={contacts} />`.

Also update the `CampaignDetailClient` props type to accept `contacts` and the enrollment type to include `contactId: string`.

- [ ] **Step 3: Update campaign-detail-client.tsx — add metric cards**

In `app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx`, find the statistics/cards section. Replace or add the four metric cards:

```tsx
// Compute metrics from enrollments prop:
const totalEnrolled = enrollments.length;
const completed = enrollments.filter((e) => e.status === "COMPLETED").length;
const inProgress = enrollments.filter((e) => e.status === "ACTIVE").length;
const failed = enrollments.filter((e) =>
  e.executions.some((x) => x.status === "FAILED")
).length;

// Render:
<div className="grid grid-cols-4 gap-4">
  {[
    { label: "רשומים", value: totalEnrolled },
    { label: "הושלמו", value: completed },
    { label: "בתהליך", value: inProgress },
    { label: "נכשלו", value: failed },
  ].map(({ label, value }) => (
    <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  ))}
</div>
```

- [ ] **Step 4: Add "Next step date" column to enrollment table**

In the enrollment table, add a "שלב הבא" column. For each enrollment, find the first PENDING execution and show its `scheduledAt` formatted as a date:

```tsx
// Helper at top of component (or in a utils file):
function nextStepDate(executions: Array<{ status: string; scheduledAt: string }>): string {
  const pending = executions.find((x) => x.status === "PENDING");
  if (!pending) return "—";
  return new Date(pending.scheduledAt).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// In the table header row, add:
<th>שלב הבא</th>

// In each table data row, add:
<td>{nextStepDate(enrollment.executions)}</td>
```

- [ ] **Step 5: Add "+ Add Contacts" button with search modal**

In `campaign-detail-client.tsx`, add state and handler for manual enrollment:

```tsx
// State:
const [showEnrollModal, setShowEnrollModal] = useState(false);
const [enrollSearch, setEnrollSearch] = useState("");
const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
const [enrolling, setEnrolling] = useState(false);

// Enrolled contact IDs for filtering (uses contactId on the enrollment, not the nested contact):
const enrolledContactIds = new Set(enrollments.map((e) => e.contactId));

// Filtered contacts for search modal:
const filteredContacts = contacts
  .filter((c) => !enrolledContactIds.has(c.id))
  .filter((c) =>
    enrollSearch
      ? c.fullName.toLowerCase().includes(enrollSearch.toLowerCase())
      : true
  );

// Handler:
async function doEnroll() {
  if (selectedContactIds.size === 0) return;
  setEnrolling(true);
  try {
    const res = await fetch(`/api/sequences/${sequenceId}/enrollments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: Array.from(selectedContactIds) }),
    });
    if (res.ok) {
      setShowEnrollModal(false);
      setSelectedContactIds(new Set());
      router.refresh();
    }
  } finally {
    setEnrolling(false);
  }
}
```

Add the button above the enrollment table:

```tsx
<button
  onClick={() => setShowEnrollModal(true)}
  className="flex items-center gap-2 bg-blue-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-blue-700"
>
  <Plus size={16} />
  הוסף אנשי קשר
</button>
```

Add the modal (at end of JSX, before closing tag):

```tsx
{showEnrollModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
      <h3 className="text-lg font-semibold">הוסף אנשי קשר לקמפיין</h3>
      <input
        type="text"
        value={enrollSearch}
        onChange={(e) => setEnrollSearch(e.target.value)}
        placeholder="חיפוש..."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      <div className="max-h-64 overflow-y-auto space-y-1">
        {filteredContacts.map((c) => (
          <label key={c.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedContactIds.has(c.id)}
              onChange={(e) => {
                const next = new Set(selectedContactIds);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                setSelectedContactIds(next);
              }}
            />
            <span className="text-sm text-gray-800">{c.fullName}</span>
            {c.currentTitle && (
              <span className="text-xs text-gray-400">{c.currentTitle}</span>
            )}
          </label>
        ))}
        {filteredContacts.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">אין תוצאות</p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          onClick={doEnroll}
          disabled={enrolling || selectedContactIds.size === 0}
          className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {enrolling ? "מוסיף..." : `הוסף (${selectedContactIds.size})`}
        </button>
        <button
          onClick={() => setShowEnrollModal(false)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          ביטול
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Add Edit link to header**

In the header action buttons section, add an Edit link:

```tsx
import Link from "next/link";

// In the header buttons area:
<Link
  href={`/campaigns/${sequenceId}/edit`}
  className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
>
  ערוך
</Link>
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any type errors before committing.

- [ ] **Step 8: Commit**

```bash
git add app/(dashboard)/campaigns/[id]/page.tsx app/(dashboard)/campaigns/[id]/campaign-detail-client.tsx
git commit -m "feat: add metric cards, manual enrollment modal, and next-step column to campaign detail"
```

---

## Task 12: Remove old campaign files

**Files:**
- Delete: `app/api/campaigns/route.ts`
- Delete: `app/api/campaigns/[id]/route.ts` (and directory)
- Delete: `inngest/functions/campaign-start.ts`
- Delete: `inngest/functions/campaign-send-one.ts`
- Delete: `inngest/functions/campaign-send-email.ts`
- Delete: `inngest/functions/campaign-send-whatsapp.ts`
- Delete: `inngest/functions/campaign-finalize.ts`
- Modify: `app/api/inngest/route.ts`

- [ ] **Step 1: Delete old API routes**

```bash
rm app/api/campaigns/route.ts
rm app/api/campaigns/[id]/route.ts
rmdir app/api/campaigns/[id] 2>/dev/null; rmdir app/api/campaigns 2>/dev/null || true
```

- [ ] **Step 2: Delete old Inngest functions**

```bash
rm inngest/functions/campaign-start.ts
rm inngest/functions/campaign-send-one.ts
rm inngest/functions/campaign-send-email.ts
rm inngest/functions/campaign-send-whatsapp.ts
rm inngest/functions/campaign-finalize.ts
```

- [ ] **Step 3: Update app/api/inngest/route.ts**

Remove the five campaign function imports and registrations. The file should become:

```typescript
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { enrichContactsHaiku } from "@/inngest/functions/enrich-contacts-haiku";
import { sequenceStart } from "@/inngest/functions/sequence-start";
import { sequenceTick } from "@/inngest/functions/sequence-tick";
import { sequenceSendExecution } from "@/inngest/functions/sequence-send-execution";
import { extensionTaskResult } from "@/inngest/functions/extension-task-result";
import { extensionHeartbeatWatch } from "@/inngest/functions/extension-heartbeat-watch";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichContact,
    enrichCompanies,
    enrichCompaniesWeb,
    enrichContactsHaiku,
    sequenceStart,
    sequenceTick,
    sequenceSendExecution,
    extensionTaskResult,
    extensionHeartbeatWatch,
  ],
});
```

- [ ] **Step 4: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: clean output — no references to deleted files.

- [ ] **Step 5: Run existing tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove old campaign Inngest functions and API routes"
```
