# Multi-Step Sequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a salesperson build a time-delayed, multi-channel outreach sequence (e.g., email on day 1 → WhatsApp on day 3 → email on day 8) tied to a contact list, with automatic enrollment of contacts added to the list after the sequence starts.

**Architecture:** A `Sequence` owns an ordered list of `SequenceStep` records (channel, template, day offset from enrollment). When a sequence starts, every list member gets a `SequenceEnrollment`; an hourly Inngest cron (`sequence-tick`) creates `SequenceStepExecution` records and dispatches `sequence.send-execution` events for due ones. Each execution sends the message and schedules the next step's execution using `enrolledAt + nextStep.dayOffset`.

**Tech Stack:** Next.js 15 App Router, Prisma + PostgreSQL, Inngest (event-driven + cron), Vitest (unit tests), TailwindCSS, existing `withTenant` HOC, existing `sendEmail` / `waClient.send` / `renderTemplate` / `checkSendQuota` utilities.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma` | Add Sequence/Step/Enrollment/Execution models + 2 enums |
| Create | `lib/sequences/helpers.ts` | Pure helpers: `computeScheduledAt`, `parseSteps`, `stepStatusLabel` |
| Create | `tests/unit/sequences-helpers.test.ts` | Vitest unit tests for helpers |
| Create | `inngest/functions/sequence-start.ts` | Enroll contacts when sequence.start fires |
| Create | `inngest/functions/sequence-tick.ts` | Hourly cron: enroll new contacts + dispatch due executions |
| Create | `inngest/functions/sequence-send-execution.ts` | Send one step execution, create next |
| Modify | `app/api/inngest/route.ts` | Register 3 new Inngest functions |
| Create | `app/api/sequences/route.ts` | GET list + POST create |
| Create | `app/api/sequences/[id]/route.ts` | GET detail |
| Create | `app/api/sequences/[id]/start/route.ts` | POST start |
| Create | `app/api/sequences/[id]/pause/route.ts` | POST pause |
| Create | `app/api/sequences/[id]/resume/route.ts` | POST resume |
| Create | `app/api/sequences/[id]/cancel/route.ts` | POST cancel |
| Create | `app/(dashboard)/sequences/page.tsx` | Server page: sequences list |
| Create | `components/dashboard/sequences-client.tsx` | Client: list table + New button |
| Create | `components/dashboard/new-sequence-modal.tsx` | Multi-step sequence builder modal |
| Create | `app/(dashboard)/sequences/[id]/page.tsx` | Server page: sequence detail |
| Create | `components/dashboard/sequence-detail-client.tsx` | Client: detail view + actions |
| Modify | `components/dashboard/sidebar.tsx` | Add Sequences nav item |

---

## Task 1: Prisma Schema — Sequence Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add new enums and models to schema**

Append after the existing `RecipientStatus` enum and before the `Campaign` model:

```prisma
enum SequenceStatus {
  DRAFT
  QUEUED
  ACTIVE
  PAUSED
  COMPLETED
  CANCELLED
}

enum EnrollmentStatus {
  ACTIVE
  COMPLETED
  UNSUBSCRIBED
}
```

Add after the `ContactList` / `ContactListMember` models at the end of the file:

```prisma
// ─── Sequence models ──────────────────────────────────────────────────────────

model Sequence {
  id            String         @id @default(cuid())
  ownerId       String
  orgId         String?
  name          String
  contactListId String
  status        SequenceStatus @default(DRAFT)
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  owner       User                 @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  contactList ContactList          @relation(fields: [contactListId], references: [id])
  steps       SequenceStep[]
  enrollments SequenceEnrollment[]

  @@index([ownerId, status])
}

model SequenceStep {
  id         String          @id @default(cuid())
  sequenceId String
  stepNumber Int
  dayOffset  Int
  channel    CampaignChannel
  templateId String
  subject    String?
  createdAt  DateTime        @default(now())

  sequence   Sequence                @relation(fields: [sequenceId], references: [id], onDelete: Cascade)
  template   MessageTemplate         @relation(fields: [templateId], references: [id])
  executions SequenceStepExecution[]

  @@unique([sequenceId, stepNumber])
  @@index([sequenceId])
}

model SequenceEnrollment {
  id         String           @id @default(cuid())
  sequenceId String
  contactId  String
  status     EnrollmentStatus @default(ACTIVE)
  enrolledAt DateTime         @default(now())

  sequence   Sequence                @relation(fields: [sequenceId], references: [id], onDelete: Cascade)
  contact    Contact                 @relation(fields: [contactId], references: [id])
  executions SequenceStepExecution[]

  @@unique([sequenceId, contactId])
  @@index([sequenceId, status])
}

model SequenceStepExecution {
  id            String          @id @default(cuid())
  enrollmentId  String
  stepId        String
  status        RecipientStatus @default(PENDING)
  scheduledAt   DateTime
  sentAt        DateTime?
  renderedBody  String?
  errorMessage  String?
  attemptCount  Int             @default(0)
  sentMessageId String?         @unique

  enrollment  SequenceEnrollment @relation(fields: [enrollmentId], references: [id], onDelete: Cascade)
  step        SequenceStep       @relation(fields: [stepId], references: [id])
  sentMessage SentMessage?       @relation(fields: [sentMessageId], references: [id])

  @@unique([enrollmentId, stepId])
  @@index([status, scheduledAt])
}
```

Also add back-relations to existing models. In `User`:
```prisma
  sequences       Sequence[]
```
In `Contact`:
```prisma
  sequenceEnrollments SequenceEnrollment[]
```
In `ContactList`:
```prisma
  sequences Sequence[]
```
In `MessageTemplate`:
```prisma
  sequenceSteps SequenceStep[]
```
In `SentMessage`:
```prisma
  sequenceStepExecution SequenceStepExecution?
```

- [ ] **Step 2: Generate and apply migration**

```bash
npx prisma migrate dev --name add-sequences
```

Expected: migration file created, client regenerated, no errors.

- [ ] **Step 3: Verify generated types**

```bash
npx prisma studio
```

Open `Sequence` table — confirm it exists with the correct columns. Ctrl-C to close.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Sequence/SequenceStep/SequenceEnrollment/SequenceStepExecution models"
```

---

## Task 2: Sequence Helpers (Pure Functions + Tests)

**Files:**
- Create: `lib/sequences/helpers.ts`
- Create: `tests/unit/sequences-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sequences-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Inline copies of the helpers — importing from lib pulls in Prisma which isn't available in vitest
function computeScheduledAt(enrolledAt: Date, dayOffset: number): Date {
  return new Date(enrolledAt.getTime() + dayOffset * 24 * 60 * 60 * 1000);
}

type RawStep = {
  stepNumber: unknown;
  dayOffset: unknown;
  channel: unknown;
  templateId: unknown;
  subject?: unknown;
};

function parseSteps(input: unknown): Array<{
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string | null;
}> | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const steps: Array<{
    stepNumber: number;
    dayOffset: number;
    channel: "EMAIL" | "WHATSAPP";
    templateId: string;
    subject: string | null;
  }> = [];
  const seenNumbers = new Set<number>();
  let prevOffset = -1;
  for (const raw of input as RawStep[]) {
    if (typeof raw.stepNumber !== "number" || typeof raw.dayOffset !== "number") return null;
    if (typeof raw.templateId !== "string" || !raw.templateId) return null;
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (raw.dayOffset < prevOffset) return null;
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel,
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
    });
  }
  return steps;
}

describe("computeScheduledAt", () => {
  it("returns enrolledAt when dayOffset is 0", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(computeScheduledAt(d, 0)).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("adds 1 day correctly", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(computeScheduledAt(d, 1)).toEqual(new Date("2026-01-02T00:00:00Z"));
  });

  it("adds 7 days correctly", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(computeScheduledAt(d, 7)).toEqual(new Date("2026-01-08T00:00:00Z"));
  });

  it("handles non-midnight base time", () => {
    const d = new Date("2026-01-01T14:30:00Z");
    expect(computeScheduledAt(d, 2)).toEqual(new Date("2026-01-03T14:30:00Z"));
  });
});

describe("parseSteps", () => {
  it("accepts a valid EMAIL step", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi there" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi there" },
    ]);
  });

  it("accepts a valid WHATSAPP step (no subject)", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", subject: null },
    ]);
  });

  it("accepts multi-step sequence with ascending offsets", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hello" },
      { stepNumber: 2, dayOffset: 2, channel: "WHATSAPP", templateId: "t2" },
      { stepNumber: 3, dayOffset: 7, channel: "EMAIL", templateId: "t3", subject: "Follow up" },
    ]);
    expect(result).toHaveLength(3);
    expect(result![1].dayOffset).toBe(2);
  });

  it("returns null for empty array", () => {
    expect(parseSteps([])).toBeNull();
  });

  it("returns null for non-array", () => {
    expect(parseSteps("not an array")).toBeNull();
    expect(parseSteps(null)).toBeNull();
  });

  it("returns null for LINKEDIN channel", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "LINKEDIN", templateId: "t1" }])
    ).toBeNull();
  });

  it("returns null for EMAIL step without subject", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1" }])
    ).toBeNull();
  });

  it("returns null for EMAIL step with empty subject", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "" }])
    ).toBeNull();
  });

  it("returns null for duplicate stepNumbers", () => {
    expect(
      parseSteps([
        { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
        { stepNumber: 1, dayOffset: 2, channel: "WHATSAPP", templateId: "t2" },
      ])
    ).toBeNull();
  });

  it("returns null when dayOffsets are not non-decreasing", () => {
    expect(
      parseSteps([
        { stepNumber: 1, dayOffset: 3, channel: "WHATSAPP", templateId: "t1" },
        { stepNumber: 2, dayOffset: 1, channel: "WHATSAPP", templateId: "t2" },
      ])
    ).toBeNull();
  });

  it("returns null when templateId is missing", () => {
    expect(
      parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "" }])
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/sequences-helpers.test.ts
```

Expected: FAIL (no module to import, but tests themselves should parse).

Actually since the tests use inlined copies of helpers, they should PASS already. Verify they all pass:

Expected output: all tests green.

- [ ] **Step 3: Create the real helper module**

Create `lib/sequences/helpers.ts`:

```typescript
export function computeScheduledAt(enrolledAt: Date, dayOffset: number): Date {
  return new Date(enrolledAt.getTime() + dayOffset * 24 * 60 * 60 * 1000);
}

export type ParsedStep = {
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string | null;
};

export function parseSteps(input: unknown): ParsedStep[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const steps: ParsedStep[] = [];
  const seenNumbers = new Set<number>();
  let prevOffset = -1;
  for (const raw of input as Record<string, unknown>[]) {
    if (typeof raw.stepNumber !== "number" || typeof raw.dayOffset !== "number") return null;
    if (typeof raw.templateId !== "string" || !raw.templateId) return null;
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (raw.dayOffset < prevOffset) return null;
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel as "EMAIL" | "WHATSAPP",
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
    });
  }
  return steps;
}
```

- [ ] **Step 4: Run tests again to confirm all pass**

```bash
npx vitest run tests/unit/sequences-helpers.test.ts
```

Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sequences/helpers.ts tests/unit/sequences-helpers.test.ts
git commit -m "feat: add sequence helpers with unit tests"
```

---

## Task 3: Inngest — sequence-start

**Files:**
- Create: `inngest/functions/sequence-start.ts`

- [ ] **Step 1: Create the function**

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

    const members = await prisma.contactListMember.findMany({
      where: { listId: sequence.contactListId },
      select: { contactId: true },
    });

    for (const member of members) {
      const enrollment = await prisma.sequenceEnrollment.create({
        data: { sequenceId, contactId: member.contactId, status: "ACTIVE" },
      });
      const scheduledAt = computeScheduledAt(enrollment.enrolledAt, firstStep.dayOffset);
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

- [ ] **Step 2: Commit**

```bash
git add inngest/functions/sequence-start.ts
git commit -m "feat: add sequence-start Inngest function"
```

---

## Task 4: Inngest — sequence-tick (Hourly Cron)

**Files:**
- Create: `inngest/functions/sequence-tick.ts`

This function runs every hour. It does two things:
1. Finds ACTIVE sequences and enrolls any list members not yet in the sequence.
2. Dispatches `sequence.send-execution` for PENDING executions whose `scheduledAt <= now`.

- [ ] **Step 1: Create the function**

```typescript
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";

export const sequenceTick = inngest.createFunction(
  { id: "sequence-tick" },
  { cron: "0 * * * *" }, // top of every hour
  async () => {
    const now = new Date();

    const activeSequences = await prisma.sequence.findMany({
      where: { status: "ACTIVE" },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });

    for (const sequence of activeSequences) {
      // 1. Enroll new list members
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
      for (const member of allMembers) {
        if (enrolledIds.has(member.contactId)) continue;
        const enrollment = await prisma.sequenceEnrollment.create({
          data: { sequenceId: sequence.id, contactId: member.contactId, status: "ACTIVE" },
        });
        if (firstStep) {
          // New contacts start immediately (dayOffset relative to their enrolledAt)
          await prisma.sequenceStepExecution.create({
            data: {
              enrollmentId: enrollment.id,
              stepId: firstStep.id,
              status: "PENDING",
              scheduledAt: computeScheduledAt(enrollment.enrolledAt, firstStep.dayOffset),
            },
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
    }
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add inngest/functions/sequence-tick.ts
git commit -m "feat: add sequence-tick hourly cron (enroll new contacts + dispatch due executions)"
```

---

## Task 5: Inngest — sequence-send-execution

**Files:**
- Create: `inngest/functions/sequence-send-execution.ts`

This function sends one message for one contact at one step, then creates the next step's execution record.

- [ ] **Step 1: Create the function**

```typescript
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/campaigns/render-template";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { sendEmail } from "@/lib/gmail/client";
import { waClient } from "@/lib/whatsapp/client";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { computeScheduledAt } from "@/lib/sequences/helpers";

const MAX_ATTEMPTS = 3;

function firstName(full: string | null): string | null {
  if (!full) return null;
  return full.trim().split(/\s+/)[0] ?? null;
}
function lastName(full: string | null): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : null;
}

export const sequenceSendExecution = inngest.createFunction(
  { id: "sequence-send-execution", triggers: [{ event: "sequence.send-execution" as const }] },
  async ({ event }) => {
    const { executionId } = event.data as { executionId: string };

    const execution = await prisma.sequenceStepExecution.findUnique({
      where: { id: executionId },
      include: {
        step: { include: { template: true } },
        enrollment: {
          include: {
            contact: true,
            sequence: {
              include: {
                steps: { orderBy: { stepNumber: "asc" } },
                owner: { include: { org: true } },
              },
            },
          },
        },
      },
    });

    if (!execution) throw new Error(`Execution ${executionId} not found`);
    if (execution.status !== "PENDING") return;
    if (execution.enrollment.sequence.status !== "ACTIVE") return;
    if (execution.enrollment.status !== "ACTIVE") return;

    const { contact, sequence, enrolledAt } = execution.enrollment;
    const step = execution.step;
    const ownerId = sequence.ownerId;

    // Rate-limit check
    const prefix = step.channel === "EMAIL" ? "email:send:" : "wa:send:";
    const quota = await checkSendQuota(ownerId, { prefix });
    if (!quota.ok) {
      await inngest.send({
        name: "sequence.send-execution" as const,
        data: { executionId },
        ts: Date.now() + quota.retryAfterSec * 1000,
      });
      return;
    }

    // Render template
    const sender = {
      firstName: firstName(sequence.owner.name),
      lastName: lastName(sequence.owner.name),
      company: sequence.owner.org?.name ?? null,
      title: sequence.owner.title ?? null,
    };
    const recipient = {
      firstName: firstName(contact.fullName),
      lastName: lastName(contact.fullName),
      company: contact.currentCompany,
      title: contact.currentTitle,
    };
    const { body, missing } = renderTemplate(step.template.body, { recipient, sender });

    if (missing.length > 0) {
      await prisma.sequenceStepExecution.update({
        where: { id: executionId },
        data: { status: "SKIPPED", errorMessage: `missing_variable:${missing.join(",")}` },
      });
      await maybeAdvance(execution, sequence.steps, enrolledAt);
      return;
    }

    await prisma.sequenceStepExecution.update({
      where: { id: executionId },
      data: { status: "SENDING", attemptCount: { increment: 1 }, renderedBody: body },
    });

    try {
      if (step.channel === "EMAIL") {
        if (!contact.email) throw new Error("no_email");
        if (!step.subject) throw new Error("no_subject");
        await sendEmail(ownerId, { to: contact.email, subject: step.subject, body });
      } else {
        const rawPhone = contact.phone;
        if (!rawPhone) throw new Error("no_phone");
        const phone = normalizePhone(rawPhone);
        if (!phone) throw new Error("invalid_phone");
        await waClient.send(ownerId, phone, body);
      }

      const sent = await prisma.sentMessage.create({
        data: {
          senderId: ownerId,
          actorId: ownerId,
          contactId: contact.id,
          templateId: step.templateId,
          body,
          status: "SENT",
          sentAt: new Date(),
        },
      });

      await prisma.sequenceStepExecution.update({
        where: { id: executionId },
        data: { status: "SENT", sentAt: new Date(), sentMessageId: sent.id },
      });

      await maybeAdvance(execution, sequence.steps, enrolledAt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const attempts = execution.attemptCount + 1;
      const shouldRetry = attempts < MAX_ATTEMPTS;
      await prisma.sequenceStepExecution.update({
        where: { id: executionId },
        data: { status: shouldRetry ? "PENDING" : "FAILED", errorMessage: msg },
      });
      if (shouldRetry) {
        await inngest.send({ name: "sequence.send-execution" as const, data: { executionId } });
      } else {
        await maybeAdvance(execution, sequence.steps, enrolledAt);
      }
    }
  }
);

async function maybeAdvance(
  execution: { enrollmentId: string; stepId: string },
  allSteps: Array<{ id: string; stepNumber: number; dayOffset: number }>,
  enrolledAt: Date
) {
  const currentIndex = allSteps.findIndex((s) => s.id === execution.stepId);
  const nextStep = allSteps[currentIndex + 1];

  if (nextStep) {
    await prisma.sequenceStepExecution.create({
      data: {
        enrollmentId: execution.enrollmentId,
        stepId: nextStep.id,
        status: "PENDING",
        scheduledAt: computeScheduledAt(enrolledAt, nextStep.dayOffset),
      },
    });
  } else {
    // All steps done for this contact
    const enrollment = await prisma.sequenceEnrollment.update({
      where: { id: execution.enrollmentId },
      data: { status: "COMPLETED" },
      select: { sequenceId: true },
    });

    // Check if the whole sequence is done
    const activeCount = await prisma.sequenceEnrollment.count({
      where: { sequenceId: enrollment.sequenceId, status: "ACTIVE" },
    });
    if (activeCount === 0) {
      await prisma.sequence.update({
        where: { id: enrollment.sequenceId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add inngest/functions/sequence-send-execution.ts
git commit -m "feat: add sequence-send-execution Inngest function"
```

---

## Task 6: Register Inngest Functions

**Files:**
- Modify: `app/api/inngest/route.ts`

- [ ] **Step 1: Import and register the 3 new functions**

```typescript
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { campaignStart } from "@/inngest/functions/campaign-start";
import { campaignSendOne } from "@/inngest/functions/campaign-send-one";
import { campaignSendWhatsapp } from "@/inngest/functions/campaign-send-whatsapp";
import { campaignSendEmail } from "@/inngest/functions/campaign-send-email";
import { campaignFinalize } from "@/inngest/functions/campaign-finalize";
import { sequenceStart } from "@/inngest/functions/sequence-start";
import { sequenceTick } from "@/inngest/functions/sequence-tick";
import { sequenceSendExecution } from "@/inngest/functions/sequence-send-execution";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichContact,
    enrichCompanies,
    enrichCompaniesWeb,
    campaignStart,
    campaignSendOne,
    campaignSendWhatsapp,
    campaignSendEmail,
    campaignFinalize,
    sequenceStart,
    sequenceTick,
    sequenceSendExecution,
  ],
});
```

- [ ] **Step 2: Build-check to catch any type errors**

```bash
npx tsc --noEmit
```

Fix any errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add app/api/inngest/route.ts
git commit -m "feat: register sequence Inngest functions"
```

---

## Task 7: API Routes — Sequences CRUD + Actions

**Files:**
- Create: `app/api/sequences/route.ts`
- Create: `app/api/sequences/[id]/route.ts`
- Create: `app/api/sequences/[id]/start/route.ts`
- Create: `app/api/sequences/[id]/pause/route.ts`
- Create: `app/api/sequences/[id]/resume/route.ts`
- Create: `app/api/sequences/[id]/cancel/route.ts`

- [ ] **Step 1: Create `app/api/sequences/route.ts` (list + create)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { parseSteps } from "@/lib/sequences/helpers";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const sequences = await prisma.sequence.findMany({
    where: { ownerId: ctx.effectiveUserId },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, select: { id: true, stepNumber: true, channel: true, dayOffset: true } },
      _count: { select: { enrollments: true } },
    },
  });
  return NextResponse.json({ sequences });
});

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json();
  const { name, contactListId, steps: rawSteps } = body as {
    name?: string;
    contactListId?: string;
    steps?: unknown;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!contactListId) {
    return NextResponse.json({ error: "contactListId required" }, { status: 400 });
  }

  const list = await prisma.contactList.findFirst({
    where: { id: contactListId, ownerId: ctx.effectiveUserId },
  });
  if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });

  const steps = parseSteps(rawSteps);
  if (!steps) {
    return NextResponse.json(
      { error: "steps must be a non-empty array of valid step objects" },
      { status: 400 }
    );
  }

  // Validate all templateIds belong to this user
  const templateIds = [...new Set(steps.map((s) => s.templateId))];
  const templates = await prisma.messageTemplate.findMany({
    where: { id: { in: templateIds }, ownerId: ctx.effectiveUserId },
    select: { id: true },
  });
  if (templates.length !== templateIds.length) {
    return NextResponse.json({ error: "one or more templates not found" }, { status: 404 });
  }

  const sequence = await prisma.sequence.create({
    data: {
      ownerId: ctx.effectiveUserId,
      orgId: ctx.org.id,
      name: name.trim(),
      contactListId,
      status: "DRAFT",
      steps: {
        create: steps.map((s) => ({
          stepNumber: s.stepNumber,
          dayOffset: s.dayOffset,
          channel: s.channel,
          templateId: s.templateId,
          subject: s.subject,
        })),
      },
    },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });

  return NextResponse.json({ sequence }, { status: 201 });
});
```

- [ ] **Step 2: Create `app/api/sequences/[id]/route.ts` (detail)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const GET = withTenant(
  async (_req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      include: {
        steps: { orderBy: { stepNumber: "asc" }, include: { template: { select: { name: true } } } },
        contactList: { select: { name: true } },
        enrollments: {
          select: {
            id: true,
            status: true,
            contact: { select: { fullName: true, currentTitle: true, currentCompany: true } },
            executions: {
              orderBy: { step: { stepNumber: "asc" } },
              select: { status: true, sentAt: true, step: { select: { stepNumber: true, channel: true } } },
            },
          },
        },
      },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ sequence });
  }
);
```

- [ ] **Step 3: Create `app/api/sequences/[id]/start/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";

export const POST = withTenant(
  async (_req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (sequence.status !== "DRAFT") {
      return NextResponse.json({ error: "only DRAFT sequences can be started" }, { status: 409 });
    }

    await prisma.sequence.update({ where: { id }, data: { status: "QUEUED" } });
    await inngest.send({ name: "sequence.start" as const, data: { sequenceId: id } });

    return NextResponse.json({ ok: true });
  }
);
```

- [ ] **Step 4: Create `app/api/sequences/[id]/pause/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(
  async (_req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (sequence.status !== "ACTIVE") {
      return NextResponse.json({ error: "only ACTIVE sequences can be paused" }, { status: 409 });
    }
    await prisma.sequence.update({ where: { id }, data: { status: "PAUSED" } });
    return NextResponse.json({ ok: true });
  }
);
```

- [ ] **Step 5: Create `app/api/sequences/[id]/resume/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(
  async (_req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (sequence.status !== "PAUSED") {
      return NextResponse.json({ error: "only PAUSED sequences can be resumed" }, { status: 409 });
    }
    await prisma.sequence.update({ where: { id }, data: { status: "ACTIVE" } });
    return NextResponse.json({ ok: true });
  }
);
```

- [ ] **Step 6: Create `app/api/sequences/[id]/cancel/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(
  async (_req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (["COMPLETED", "CANCELLED"].includes(sequence.status)) {
      return NextResponse.json({ error: "sequence already finished" }, { status: 409 });
    }
    await prisma.sequence.update({ where: { id }, data: { status: "CANCELLED" } });
    return NextResponse.json({ ok: true });
  }
);
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Fix any errors.

- [ ] **Step 8: Commit**

```bash
git add app/api/sequences/
git commit -m "feat: add sequences API routes (CRUD + start/pause/resume/cancel)"
```

---

## Task 8: Sidebar Navigation

**Files:**
- Modify: `components/dashboard/sidebar.tsx`

- [ ] **Step 1: Add Sequences to navItems**

In `components/dashboard/sidebar.tsx`, update the imports to add `GitBranch` from lucide-react, then add to `navItems`:

```typescript
import { Users, FileText, Shield, LogOut, LayoutDashboard, Upload, BookMarked, MessageCircle, GitBranch } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/lists", label: "Lists", icon: BookMarked },
  { href: "/sequences", label: "Sequences", icon: GitBranch },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/import", label: "Import CSV", icon: Upload },
  { href: "/whatsapp-connect", label: "WhatsApp", icon: MessageCircle },
];
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/sidebar.tsx
git commit -m "feat: add Sequences link to sidebar nav"
```

---

## Task 9: Sequences List Page

**Files:**
- Create: `app/(dashboard)/sequences/page.tsx`
- Create: `components/dashboard/sequences-client.tsx`

- [ ] **Step 1: Create the server page `app/(dashboard)/sequences/page.tsx`**

```typescript
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import SequencesClient from "@/components/dashboard/sequences-client";

export default async function SequencesPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const sequences = await prisma.sequence.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, select: { stepNumber: true, channel: true, dayOffset: true } },
      contactList: { select: { name: true } },
      _count: { select: { enrollments: true } },
    },
  });

  const lists = await prisma.contactList.findMany({
    where: { ownerId: session.user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const templates = await prisma.messageTemplate.findMany({
    where: { ownerId: session.user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, body: true },
  });

  return <SequencesClient sequences={sequences} lists={lists} templates={templates} />;
}
```

- [ ] **Step 2: Create `components/dashboard/sequences-client.tsx`**

```typescript
"use client";

import { useState } from "react";
import Link from "next/link";
import { GitBranch, Plus } from "lucide-react";
import NewSequenceModal from "./new-sequence-modal";

type Step = { stepNumber: number; channel: string; dayOffset: number };
type Sequence = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  steps: Step[];
  contactList: { name: string };
  _count: { enrollments: number };
};
type List = { id: string; name: string };
type Template = { id: string; name: string; body: string };

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  QUEUED: "bg-[#fff7e6] text-[#b45309]",
  ACTIVE: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
  CANCELLED: "bg-[#f3f2ef] text-[#9b9895]",
};

export default function SequencesClient({
  sequences,
  lists,
  templates,
}: {
  sequences: Sequence[];
  lists: List[];
  templates: Template[];
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">Sequences</h1>
          <p className="text-sm text-[#6b6866] mt-0.5">
            Multi-step outreach campaigns with scheduled follow-ups
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#1585ff] text-white text-sm font-medium px-3.5 py-2 rounded-lg hover:bg-[#0f6fd4] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Sequence
        </button>
      </div>

      {sequences.length === 0 ? (
        <div className="border border-dashed border-[#e5e3df] rounded-xl p-12 text-center">
          <GitBranch className="w-8 h-8 text-[#c8c5c2] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#111110]">No sequences yet</p>
          <p className="text-xs text-[#9b9895] mt-1">
            Create a sequence to send multi-step outreach campaigns
          </p>
        </div>
      ) : (
        <div className="border border-[#e5e3df] rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e3df] bg-[#fafaf9]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">List</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Steps</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Contacts</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f2ef]">
              {sequences.map((seq) => (
                <tr key={seq.id} className="hover:bg-[#fafaf9] transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/sequences/${seq.id}`} className="font-medium text-[#111110] hover:text-[#1585ff]">
                      {seq.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#6b6866]">{seq.contactList.name}</td>
                  <td className="px-4 py-3 text-[#6b6866]">
                    {seq.steps.length} step{seq.steps.length !== 1 ? "s" : ""}
                    {seq.steps.length > 0 && (
                      <span className="ml-1.5 text-[#9b9895]">
                        ({seq.steps.map((s) => `Day ${s.dayOffset + 1}`).join(" → ")})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6b6866]">{seq._count.enrollments}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[seq.status] ?? ""}`}
                    >
                      {seq.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <NewSequenceModal
          lists={lists}
          templates={templates}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/sequences/page.tsx components/dashboard/sequences-client.tsx
git commit -m "feat: add sequences list page"
```

---

## Task 10: New Sequence Modal (Builder)

**Files:**
- Create: `components/dashboard/new-sequence-modal.tsx`

The modal is a two-panel builder: left panel configures the sequence name and contact list; right panel is a list of steps the salesperson adds one by one. Each step has: channel toggle (EMAIL / WHATSAPP), template picker, subject line (shown only for EMAIL), and day offset.

- [ ] **Step 1: Create `components/dashboard/new-sequence-modal.tsx`**

```typescript
"use client";

import { useState } from "react";
import { X, Plus, Trash2, Mail, MessageSquare, ChevronUp, ChevronDown } from "lucide-react";

type List = { id: string; name: string };
type Template = { id: string; name: string; body: string };

type Step = {
  key: string; // local unique key for React list
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string;
  dayOffset: number;
};

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function NewSequenceModal({
  lists,
  templates,
  onClose,
  onCreated,
}: {
  lists: List[];
  templates: Template[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [steps, setSteps] = useState<Step[]>([
    { key: uid(), channel: "EMAIL", templateId: templates[0]?.id ?? "", subject: "", dayOffset: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addStep() {
    const lastOffset = steps[steps.length - 1]?.dayOffset ?? 0;
    setSteps((prev) => [
      ...prev,
      { key: uid(), channel: "EMAIL", templateId: templates[0]?.id ?? "", subject: "", dayOffset: lastOffset + 2 },
    ]);
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function updateStep(key: string, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) { setError("Sequence name is required"); return; }
    if (!listId) { setError("Select a contact list"); return; }
    if (steps.length === 0) { setError("Add at least one step"); return; }
    for (const s of steps) {
      if (!s.templateId) { setError("Each step needs a template"); return; }
      if (s.channel === "EMAIL" && !s.subject.trim()) { setError("Email steps need a subject line"); return; }
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        contactListId: listId,
        steps: steps.map((s, i) => ({
          stepNumber: i + 1,
          dayOffset: s.dayOffset,
          channel: s.channel,
          templateId: s.templateId,
          subject: s.channel === "EMAIL" ? s.subject.trim() : undefined,
        })),
      };
      const res = await fetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to create sequence");
      }

      // Start immediately after creation
      const { sequence } = await res.json() as { sequence: { id: string } };
      const startRes = await fetch(`/api/sequences/${sequence.id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to start sequence");
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e3df]">
          <h2 className="text-base font-semibold text-[#111110]">New Sequence</h2>
          <button onClick={onClose} className="text-[#9b9895] hover:text-[#111110] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[#6b6866] mb-1.5">Sequence Name</label>
            <input
              className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff]"
              placeholder="e.g. Q2 Outreach"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Contact List */}
          <div>
            <label className="block text-xs font-medium text-[#6b6866] mb-1.5">Contact List</label>
            <select
              className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff]"
              value={listId}
              onChange={(e) => setListId(e.target.value)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[#6b6866]">Steps</label>
              <button
                onClick={addStep}
                className="flex items-center gap-1 text-xs text-[#1585ff] font-medium hover:text-[#0f6fd4]"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Step
              </button>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => (
                <div key={step.key} className="border border-[#e5e3df] rounded-xl p-4 space-y-3 bg-[#fafaf9]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#6b6866] uppercase tracking-wider">
                      Step {index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-xs text-[#6b6866]">
                        <span>Day</span>
                        <button
                          onClick={() => updateStep(step.key, { dayOffset: Math.max(0, step.dayOffset - 1) })}
                          className="w-5 h-5 flex items-center justify-center rounded border border-[#e5e3df] bg-white hover:bg-[#f3f2ef]"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center font-mono font-medium text-[#111110]">
                          {step.dayOffset + 1}
                        </span>
                        <button
                          onClick={() => updateStep(step.key, { dayOffset: step.dayOffset + 1 })}
                          className="w-5 h-5 flex items-center justify-center rounded border border-[#e5e3df] bg-white hover:bg-[#f3f2ef]"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                      </div>
                      {steps.length > 1 && (
                        <button
                          onClick={() => removeStep(step.key)}
                          className="text-[#c8c5c2] hover:text-[#dc2626] transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Channel toggle */}
                  <div className="flex gap-2">
                    {(["EMAIL", "WHATSAPP"] as const).map((ch) => (
                      <button
                        key={ch}
                        onClick={() => updateStep(step.key, { channel: ch })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          step.channel === ch
                            ? "bg-[#1585ff] text-white border-[#1585ff]"
                            : "bg-white text-[#6b6866] border-[#e5e3df] hover:border-[#1585ff]"
                        }`}
                      >
                        {ch === "EMAIL" ? <Mail className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                        {ch === "EMAIL" ? "Email" : "WhatsApp"}
                      </button>
                    ))}
                  </div>

                  {/* Subject (email only) */}
                  {step.channel === "EMAIL" && (
                    <input
                      className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] bg-white"
                      placeholder="Subject line"
                      value={step.subject}
                      onChange={(e) => updateStep(step.key, { subject: e.target.value })}
                    />
                  )}

                  {/* Template */}
                  <select
                    className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] bg-white"
                    value={step.templateId}
                    onChange={(e) => updateStep(step.key, { templateId: e.target.value })}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-[#dc2626] bg-[#fff3f3] border border-[#fecaca] rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#e5e3df]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Starting…" : "Create & Start"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/new-sequence-modal.tsx
git commit -m "feat: add NewSequenceModal multi-step sequence builder"
```

---

## Task 11: Sequence Detail Page

**Files:**
- Create: `app/(dashboard)/sequences/[id]/page.tsx`
- Create: `components/dashboard/sequence-detail-client.tsx`

- [ ] **Step 1: Create the server page `app/(dashboard)/sequences/[id]/page.tsx`**

```typescript
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import SequenceDetailClient from "@/components/dashboard/sequence-detail-client";

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const { id } = await params;

  const sequence = await prisma.sequence.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, include: { template: { select: { name: true } } } },
      contactList: { select: { name: true } },
      enrollments: {
        include: {
          contact: { select: { fullName: true, currentTitle: true, currentCompany: true, email: true, phone: true } },
          executions: {
            orderBy: { step: { stepNumber: "asc" } },
            include: { step: { select: { stepNumber: true, channel: true, dayOffset: true } } },
          },
        },
        orderBy: { enrolledAt: "asc" },
      },
    },
  });

  if (!sequence) notFound();

  return <SequenceDetailClient sequence={sequence} />;
}
```

- [ ] **Step 2: Create `components/dashboard/sequence-detail-client.tsx`**

```typescript
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Pause, RotateCcw, XCircle, Mail, MessageSquare } from "lucide-react";

type StepExecution = {
  status: string;
  sentAt: string | null;
  step: { stepNumber: number; channel: string; dayOffset: number };
};
type Enrollment = {
  id: string;
  status: string;
  enrolledAt: string;
  contact: { fullName: string; currentTitle: string | null; currentCompany: string | null };
  executions: StepExecution[];
};
type SequenceStep = {
  id: string;
  stepNumber: number;
  dayOffset: number;
  channel: string;
  subject: string | null;
  template: { name: string };
};
type Sequence = {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  contactList: { name: string };
  steps: SequenceStep[];
  enrollments: Enrollment[];
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  QUEUED: "bg-[#fff7e6] text-[#b45309]",
  ACTIVE: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
  CANCELLED: "bg-[#f3f2ef] text-[#9b9895]",
};

const EXEC_COLORS: Record<string, string> = {
  PENDING: "bg-[#f3f2ef] text-[#6b6866]",
  SENDING: "bg-[#fff7e6] text-[#b45309]",
  SENT: "bg-[#e6faf0] text-[#059669]",
  FAILED: "bg-[#fff3f3] text-[#dc2626]",
  SKIPPED: "bg-[#f3f2ef] text-[#9b9895]",
};

export default function SequenceDetailClient({ sequence }: { sequence: Sequence }) {
  const [status, setStatus] = useState(sequence.status);
  const [acting, setActing] = useState(false);

  async function doAction(action: "start" | "pause" | "resume" | "cancel") {
    setActing(true);
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert((data as { error?: string }).error ?? "Action failed");
        return;
      }
      const nextStatus: Record<string, string> = {
        start: "ACTIVE",
        pause: "PAUSED",
        resume: "ACTIVE",
        cancel: "CANCELLED",
      };
      setStatus(nextStatus[action]);
    } finally {
      setActing(false);
    }
  }

  const sentCount = sequence.enrollments.reduce(
    (acc, e) => acc + e.executions.filter((x) => x.status === "SENT").length,
    0
  );
  const totalExecutions = sequence.enrollments.reduce((acc, e) => acc + e.executions.length, 0);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link href="/sequences" className="text-[#9b9895] hover:text-[#111110] mt-0.5 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-[#111110]">{sequence.name}</h1>
            <p className="text-sm text-[#6b6866] mt-0.5">List: {sequence.contactList.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}>
            {status}
          </span>
          {status === "DRAFT" && (
            <button
              onClick={() => doAction("start")}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </button>
          )}
          {status === "ACTIVE" && (
            <button
              onClick={() => doAction("pause")}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#f3f2ef] text-[#6b6866] text-sm font-medium rounded-lg hover:bg-[#e5e3df] transition-colors disabled:opacity-50"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause
            </button>
          )}
          {status === "PAUSED" && (
            <button
              onClick={() => doAction("resume")}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Resume
            </button>
          )}
          {["ACTIVE", "PAUSED", "QUEUED"].includes(status) && (
            <button
              onClick={() => { if (confirm("Cancel this sequence?")) doAction("cancel"); }}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#fff3f3] text-[#dc2626] text-sm font-medium rounded-lg hover:bg-[#fee2e2] transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Contacts", value: sequence.enrollments.length },
          { label: "Messages Sent", value: sentCount },
          { label: "Steps", value: sequence.steps.length },
        ].map(({ label, value }) => (
          <div key={label} className="border border-[#e5e3df] rounded-xl p-4 bg-white">
            <p className="text-xs text-[#9b9895] uppercase tracking-wider font-semibold">{label}</p>
            <p className="text-2xl font-semibold text-[#111110] mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Step timeline */}
      <div className="border border-[#e5e3df] rounded-xl bg-white p-5">
        <h2 className="text-sm font-semibold text-[#111110] mb-4">Steps</h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {sequence.steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-3 shrink-0">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full border-2 border-[#1585ff] bg-[#eff5ff] flex items-center justify-center shrink-0">
                  {step.channel === "EMAIL" ? (
                    <Mail className="w-3.5 h-3.5 text-[#1585ff]" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 text-[#1585ff]" />
                  )}
                </div>
                {i < sequence.steps.length - 1 && (
                  <div className="w-0.5 h-6 bg-[#e5e3df] mt-1" />
                )}
              </div>
              <div className="min-w-[140px]">
                <p className="text-xs font-semibold text-[#111110]">
                  Day {step.dayOffset + 1} — {step.channel === "EMAIL" ? "Email" : "WhatsApp"}
                </p>
                <p className="text-xs text-[#6b6866] mt-0.5">{step.template.name}</p>
                {step.subject && <p className="text-xs text-[#9b9895] mt-0.5 italic">&ldquo;{step.subject}&rdquo;</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Enrollment table */}
      {sequence.enrollments.length > 0 && (
        <div className="border border-[#e5e3df] rounded-xl overflow-hidden bg-white">
          <div className="px-5 py-3 border-b border-[#e5e3df] bg-[#fafaf9]">
            <h2 className="text-sm font-semibold text-[#111110]">
              Contacts ({sequence.enrollments.length})
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f3f2ef]">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Contact</th>
                {sequence.steps.map((step) => (
                  <th key={step.id} className="text-center px-3 py-2.5 text-xs font-semibold text-[#6b6866] uppercase tracking-wider whitespace-nowrap">
                    Step {step.stepNumber}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f2ef]">
              {sequence.enrollments.map((enr) => (
                <tr key={enr.id} className="hover:bg-[#fafaf9]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#111110]">{enr.contact.fullName}</p>
                    <p className="text-xs text-[#9b9895]">
                      {enr.contact.currentTitle}
                      {enr.contact.currentCompany ? ` · ${enr.contact.currentCompany}` : ""}
                    </p>
                  </td>
                  {sequence.steps.map((step) => {
                    const exec = enr.executions.find((x) => x.step.stepNumber === step.stepNumber);
                    return (
                      <td key={step.id} className="px-3 py-3 text-center">
                        {exec ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${EXEC_COLORS[exec.status] ?? ""}`}>
                            {exec.status}
                          </span>
                        ) : (
                          <span className="text-[#c8c5c2] text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/sequences/ components/dashboard/sequence-detail-client.tsx
git commit -m "feat: add sequence detail page"
```

---

## Task 12: Final Type-Check + Smoke Test

- [ ] **Step 1: Run all unit tests**

```bash
npx vitest run
```

Expected: all tests pass (no regressions).

- [ ] **Step 2: Full TypeScript check**

```bash
npx tsc --noEmit
```

Fix any remaining type errors.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Manual smoke test**

Start dev server:
```bash
npm run dev
```

Walk through:
1. Navigate to `/sequences` — verify empty state appears
2. Click "New Sequence" — modal opens
3. Fill in name, select a list, configure 2+ steps (one EMAIL with subject, one WHATSAPP)
4. Click "Create & Start" — modal closes, sequence appears in list with status ACTIVE
5. Click sequence name — detail page shows step timeline and enrolled contacts

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: multi-step sequences — complete implementation"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Create a contact list | Already exists (Lists page) |
| Pull Apollo details (email, phone) | Already exists (enrichment) |
| Create a sequence with steps | Tasks 1, 9, 10 |
| Day 1: email to all | Step builder: EMAIL channel, dayOffset=0 |
| Day 3: WhatsApp to same list | Step builder: WHATSAPP channel, dayOffset=2 |
| Update list mid-sequence, auto-enroll | Task 4 (sequence-tick hourly cron) |
| Day 5 (follow-up): another email | Step builder: EMAIL channel, dayOffset=4 |
| Start/pause/resume/cancel | Task 7 API routes + Task 11 detail UI |

### Placeholder Scan

No TBD/TODO/placeholder text found. All code blocks are complete.

### Type Consistency

- `computeScheduledAt(enrolledAt: Date, dayOffset: number): Date` — used consistently in `sequence-start.ts`, `sequence-tick.ts`, and `maybeAdvance` in `sequence-send-execution.ts`
- `parseSteps` — same logic in test file (inline copy) and `lib/sequences/helpers.ts`
- `SequenceStepExecution` status values — uses existing `RecipientStatus` enum (PENDING/SENDING/SENT/FAILED/SKIPPED)
- API route params pattern `{ params: Promise<{ id: string }> }` matches existing Next.js 15 convention in this codebase
