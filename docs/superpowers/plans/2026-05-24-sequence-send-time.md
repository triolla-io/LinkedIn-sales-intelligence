# Sequence Send Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-step send time (hour + minute, Israel timezone) to sequences so messages go out at a predictable time of day, and show the scheduled send time on PENDING executions in the detail UI.

**Architecture:** Add `sendHour`/`sendMinute` integers to `SequenceStep`. Update `computeScheduledAt` to use `date-fns-tz` to convert an Israel wall-clock time to UTC. Pass the new fields through all three Inngest functions and the sequence builder modal. Add `scheduledAt` to the detail page execution data so PENDING cells show "22/05 09:30 (בעוד 14 שעות)".

**Tech Stack:** Prisma + PostgreSQL, `date-fns-tz` (new dependency), Inngest, Next.js 15 App Router, Vitest.

---

## File Map

| Action | Path | What changes |
|--------|------|-------------|
| Modify | `prisma/schema.prisma` | Add `sendHour Int @default(9)`, `sendMinute Int @default(0)` to `SequenceStep` |
| Create | `prisma/migrations/…_add_step_send_time/` | Auto-generated migration |
| Modify | `lib/sequences/helpers.ts` | New `computeScheduledAt` signature + `date-fns-tz`, extend `ParsedStep` + `parseSteps` |
| Modify | `tests/unit/sequences-helpers.test.ts` | Update inline copies + tests for new signature |
| Modify | `inngest/functions/sequence-start.ts` | Pass `sendHour`/`sendMinute` to `computeScheduledAt` |
| Modify | `inngest/functions/sequence-tick.ts` | Pass `sendHour`/`sendMinute` for new-enrollment executions |
| Modify | `inngest/functions/sequence-send-execution.ts` | Extend `maybeAdvance` type + pass `sendHour`/`sendMinute` |
| Modify | `app/api/sequences/[id]/route.ts` | Add `scheduledAt` to execution select |
| Modify | `components/dashboard/new-sequence-modal.tsx` | Add time picker (HH:MM) per step |
| Modify | `components/dashboard/sequence-detail-client.tsx` | Show scheduledAt on PENDING cells |

---

## Task 1: Install date-fns-tz + Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/…_add_step_send_time/`

- [ ] **Step 1: Install date-fns-tz**

```bash
npm install date-fns-tz
```

Expected: package added to `node_modules` and `package.json`.

- [ ] **Step 2: Add fields to SequenceStep in schema**

In `prisma/schema.prisma`, find the `SequenceStep` model. Add two fields after `dayOffset`:

```prisma
model SequenceStep {
  id         String          @id @default(cuid())
  sequenceId String
  stepNumber Int
  dayOffset  Int
  sendHour   Int             @default(9)
  sendMinute Int             @default(0)
  channel    CampaignChannel
  templateId String
  subject    String?
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt

  sequence   Sequence                @relation(fields: [sequenceId], references: [id], onDelete: Cascade)
  template   MessageTemplate         @relation(fields: [templateId], references: [id])
  executions SequenceStepExecution[]

  @@unique([sequenceId, stepNumber])
  @@index([sequenceId])
}
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name add_step_send_time
```

Expected: migration file created, Prisma client regenerated, no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ package.json package-lock.json
git commit -m "feat: add sendHour/sendMinute to SequenceStep, install date-fns-tz"
```

---

## Task 2: Update Helpers + Tests

**Files:**
- Modify: `lib/sequences/helpers.ts`
- Modify: `tests/unit/sequences-helpers.test.ts`

- [ ] **Step 1: Write the failing tests first**

Replace the content of `tests/unit/sequences-helpers.test.ts` with the following. The inline helpers are updated to match the new signatures:

```typescript
import { describe, it, expect } from "vitest";

// Inline copies — importing from lib pulls in Prisma/date-fns-tz not available in vitest
// computeScheduledAt uses a simplified UTC-offset approximation for tests (Israel = UTC+2 in winter)
const ISRAEL_OFFSET_MS = 2 * 60 * 60 * 1000; // UTC+2 winter (test dates are in January)

function computeScheduledAt(
  enrolledAt: Date,
  dayOffset: number,
  sendHour: number,
  sendMinute: number
): Date {
  const base = new Date(enrolledAt);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, "0");
  const day = String(base.getUTCDate()).padStart(2, "0");
  const h = String(sendHour).padStart(2, "0");
  const m = String(sendMinute).padStart(2, "0");
  // Approximate: subtract Israel offset to get UTC
  const localMs = new Date(`${year}-${month}-${day}T${h}:${m}:00Z`).getTime();
  return new Date(localMs - ISRAEL_OFFSET_MS);
}

type RawStep = {
  stepNumber: unknown;
  dayOffset: unknown;
  channel: unknown;
  templateId: unknown;
  subject?: unknown;
  sendHour?: unknown;
  sendMinute?: unknown;
};

function parseSteps(input: unknown): Array<{
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string | null;
  sendHour: number;
  sendMinute: number;
}> | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const steps: Array<{
    stepNumber: number;
    dayOffset: number;
    channel: "EMAIL" | "WHATSAPP";
    templateId: string;
    subject: string | null;
    sendHour: number;
    sendMinute: number;
  }> = [];
  const seenNumbers = new Set<number>();
  let prevOffset: number | null = null;
  for (const raw of input as RawStep[]) {
    if (typeof raw.stepNumber !== "number" || typeof raw.dayOffset !== "number") return null;
    if (!Number.isInteger(raw.dayOffset) || raw.dayOffset < 0) return null;
    if (typeof raw.templateId !== "string" || !raw.templateId) return null;
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (prevOffset !== null && raw.dayOffset < prevOffset) return null;
    const rawHour = raw.sendHour ?? 9;
    const rawMinute = raw.sendMinute ?? 0;
    if (!Number.isInteger(rawHour) || (rawHour as number) < 0 || (rawHour as number) > 23) return null;
    if (!Number.isInteger(rawMinute) || (rawMinute as number) < 0 || (rawMinute as number) > 59) return null;
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel as "EMAIL" | "WHATSAPP",
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
      sendHour: rawHour as number,
      sendMinute: rawMinute as number,
    });
  }
  return steps;
}

describe("computeScheduledAt", () => {
  it("schedules at 09:00 Israel time (UTC+2 winter) when dayOffset is 0", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z"); // 08:00 Israel
    const result = computeScheduledAt(enrolled, 0, 9, 0);
    expect(result).toEqual(new Date("2026-01-15T07:00:00Z")); // 09:00 Israel = 07:00 UTC
  });

  it("adds dayOffset calendar days to the enrollment date", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z");
    const result = computeScheduledAt(enrolled, 2, 9, 0);
    expect(result).toEqual(new Date("2026-01-17T07:00:00Z")); // 09:00 Israel on Jan 17
  });

  it("respects sendMinute", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z");
    const result = computeScheduledAt(enrolled, 0, 9, 30);
    expect(result).toEqual(new Date("2026-01-15T07:30:00Z")); // 09:30 Israel = 07:30 UTC
  });

  it("handles 14:00 sendHour", () => {
    const enrolled = new Date("2026-01-15T06:00:00Z");
    const result = computeScheduledAt(enrolled, 0, 14, 0);
    expect(result).toEqual(new Date("2026-01-15T12:00:00Z")); // 14:00 Israel = 12:00 UTC
  });
});

describe("parseSteps", () => {
  it("accepts a valid EMAIL step with default send time", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hi", sendHour: 9, sendMinute: 0 },
    ]);
  });

  it("accepts explicit sendHour and sendMinute", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendHour: 14, sendMinute: 30 },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", subject: null, sendHour: 14, sendMinute: 30 },
    ]);
  });

  it("accepts a valid WHATSAPP step (no subject)", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
    ]);
    expect(result).toEqual([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", subject: null, sendHour: 9, sendMinute: 0 },
    ]);
  });

  it("accepts multi-step sequence with ascending offsets", () => {
    const result = parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "Hello", sendHour: 9, sendMinute: 0 },
      { stepNumber: 2, dayOffset: 2, channel: "WHATSAPP", templateId: "t2", sendHour: 14, sendMinute: 30 },
    ]);
    expect(result).toHaveLength(2);
    expect(result![1].sendHour).toBe(14);
    expect(result![1].sendMinute).toBe(30);
  });

  it("returns null for empty array", () => {
    expect(parseSteps([])).toBeNull();
  });

  it("returns null for non-array", () => {
    expect(parseSteps("not an array")).toBeNull();
    expect(parseSteps(null)).toBeNull();
  });

  it("returns null for LINKEDIN channel", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "LINKEDIN", templateId: "t1" }])).toBeNull();
  });

  it("returns null for EMAIL step without subject", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1" }])).toBeNull();
  });

  it("returns null for EMAIL step with empty subject", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "EMAIL", templateId: "t1", subject: "" }])).toBeNull();
  });

  it("returns null for duplicate stepNumbers", () => {
    expect(parseSteps([
      { stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1" },
      { stepNumber: 1, dayOffset: 2, channel: "WHATSAPP", templateId: "t2" },
    ])).toBeNull();
  });

  it("returns null when dayOffsets are not non-decreasing", () => {
    expect(parseSteps([
      { stepNumber: 1, dayOffset: 3, channel: "WHATSAPP", templateId: "t1" },
      { stepNumber: 2, dayOffset: 1, channel: "WHATSAPP", templateId: "t2" },
    ])).toBeNull();
  });

  it("returns null when templateId is missing", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "" }])).toBeNull();
  });

  it("returns null for negative dayOffset", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: -1, channel: "WHATSAPP", templateId: "t1" }])).toBeNull();
  });

  it("returns null for fractional dayOffset", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 1.5, channel: "WHATSAPP", templateId: "t1" }])).toBeNull();
  });

  it("returns null for sendHour out of range", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendHour: 24 }])).toBeNull();
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendHour: -1 }])).toBeNull();
  });

  it("returns null for sendMinute out of range", () => {
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendMinute: 60 }])).toBeNull();
    expect(parseSteps([{ stepNumber: 1, dayOffset: 0, channel: "WHATSAPP", templateId: "t1", sendMinute: -1 }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail on the old helpers**

```bash
npx vitest run tests/unit/sequences-helpers.test.ts
```

Expected: several tests FAIL (old `computeScheduledAt` doesn't accept 4 args, `parseSteps` doesn't return `sendHour`/`sendMinute`).

- [ ] **Step 3: Update `lib/sequences/helpers.ts`**

Replace the entire file with:

```typescript
import { fromZonedTime } from "date-fns-tz";

const TIMEZONE = "Asia/Jerusalem";

export function computeScheduledAt(
  enrolledAt: Date,
  dayOffset: number,
  sendHour: number,
  sendMinute: number
): Date {
  const base = new Date(enrolledAt);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, "0");
  const day = String(base.getUTCDate()).padStart(2, "0");
  const h = String(sendHour).padStart(2, "0");
  const m = String(sendMinute).padStart(2, "0");
  return fromZonedTime(`${year}-${month}-${day}T${h}:${m}:00`, TIMEZONE);
}

export type ParsedStep = {
  stepNumber: number;
  dayOffset: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string | null;
  sendHour: number;
  sendMinute: number;
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
    if (raw.channel !== "EMAIL" && raw.channel !== "WHATSAPP") return null;
    if (raw.channel === "EMAIL" && (typeof raw.subject !== "string" || !raw.subject)) return null;
    if (seenNumbers.has(raw.stepNumber)) return null;
    if (prevOffset !== null && raw.dayOffset < prevOffset) return null;
    const rawHour = raw.sendHour ?? 9;
    const rawMinute = raw.sendMinute ?? 0;
    if (!Number.isInteger(rawHour) || (rawHour as number) < 0 || (rawHour as number) > 23) return null;
    if (!Number.isInteger(rawMinute) || (rawMinute as number) < 0 || (rawMinute as number) > 59) return null;
    seenNumbers.add(raw.stepNumber);
    prevOffset = raw.dayOffset;
    steps.push({
      stepNumber: raw.stepNumber,
      dayOffset: raw.dayOffset,
      channel: raw.channel as "EMAIL" | "WHATSAPP",
      templateId: raw.templateId,
      subject: raw.channel === "EMAIL" ? (raw.subject as string) : null,
      sendHour: rawHour as number,
      sendMinute: rawMinute as number,
    });
  }
  return steps;
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run tests/unit/sequences-helpers.test.ts
```

Expected: all tests PASS (including the new `computeScheduledAt` and `parseSteps` tests).

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/sequences/helpers.ts tests/unit/sequences-helpers.test.ts
git commit -m "feat: add sendHour/sendMinute to computeScheduledAt and parseSteps"
```

---

## Task 3: Update Inngest Functions

**Files:**
- Modify: `inngest/functions/sequence-start.ts`
- Modify: `inngest/functions/sequence-tick.ts`
- Modify: `inngest/functions/sequence-send-execution.ts`

All three callers of `computeScheduledAt` need to pass `sendHour` and `sendMinute` from the step. The Prisma `include` for steps must select these new fields (they are auto-included since we load the full step object, but we must type-check).

- [ ] **Step 1: Update `inngest/functions/sequence-start.ts`**

Change the `computeScheduledAt` call on line where `scheduledAt` is computed:

```typescript
const scheduledAt = computeScheduledAt(
  enrollment.enrolledAt,
  firstStep.dayOffset,
  firstStep.sendHour,
  firstStep.sendMinute
);
```

The `sequence.steps` include already returns full step objects (no `select` restriction), so `firstStep.sendHour` and `firstStep.sendMinute` are available automatically after the migration.

- [ ] **Step 2: Update `inngest/functions/sequence-tick.ts`**

In the new-enrollment section, change the `computeScheduledAt` call:

```typescript
scheduledAt: computeScheduledAt(enr.enrolledAt, firstStep.dayOffset, firstStep.sendHour, firstStep.sendMinute),
```

- [ ] **Step 3: Update `maybeAdvance` in `inngest/functions/sequence-send-execution.ts`**

The `allSteps` type must include the new fields. Update the function signature:

```typescript
async function maybeAdvance(
  enrollmentId: string,
  currentStepId: string,
  allSteps: Array<{ id: string; stepNumber: number; dayOffset: number; sendHour: number; sendMinute: number }>,
  enrolledAt: Date
) {
```

Update the `computeScheduledAt` call inside:

```typescript
scheduledAt: computeScheduledAt(enrolledAt, nextStep.dayOffset, nextStep.sendHour, nextStep.sendMinute),
```

The `sequence.steps` include in the same file already returns full step objects, so `sendHour`/`sendMinute` are present.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "sequence-(start|tick|send)" | head -20
```

Expected: no errors for these files.

- [ ] **Step 5: Commit**

```bash
git add inngest/functions/sequence-start.ts inngest/functions/sequence-tick.ts inngest/functions/sequence-send-execution.ts
git commit -m "feat: pass sendHour/sendMinute through all Inngest scheduling calls"
```

---

## Task 4: Update Detail API Route

**Files:**
- Modify: `app/api/sequences/[id]/route.ts`

Add `scheduledAt` to the execution select so the UI can display it.

- [ ] **Step 1: Add `scheduledAt` to execution select**

In `app/api/sequences/[id]/route.ts`, find the `executions` select block and add `scheduledAt: true`:

```typescript
executions: {
  orderBy: { step: { stepNumber: "asc" } },
  select: {
    status: true,
    sentAt: true,
    scheduledAt: true,
    step: { select: { stepNumber: true, channel: true } },
  },
},
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "sequences/\[id\]" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/sequences/[id]/route.ts"
git commit -m "feat: include scheduledAt in sequence detail execution select"
```

---

## Task 5: Update Sequence Builder Modal — Time Picker

**Files:**
- Modify: `components/dashboard/new-sequence-modal.tsx`

Add `sendHour` and `sendMinute` to the Step type and render a time picker per step.

- [ ] **Step 1: Update the Step type and initial state**

Find the `type Step` definition and add:
```typescript
type Step = {
  key: string;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string;
  dayOffset: number;
  sendHour: number;
  sendMinute: number;
};
```

Update the initial step in `useState`:
```typescript
const [steps, setSteps] = useState<Step[]>([
  { key: uid(), channel: "EMAIL", templateId: templates[0]?.id ?? "", subject: "", dayOffset: 0, sendHour: 9, sendMinute: 0 },
]);
```

Update `addStep` to include defaults:
```typescript
function addStep() {
  const lastOffset = steps[steps.length - 1]?.dayOffset ?? 0;
  setSteps((prev) => [
    ...prev,
    { key: uid(), channel: "EMAIL", templateId: templates[0]?.id ?? "", subject: "", dayOffset: lastOffset + 2, sendHour: 9, sendMinute: 0 },
  ]);
}
```

- [ ] **Step 2: Add time picker to the step card JSX**

Inside each step card, after the day offset controls and before the channel toggle, add the time picker:

```tsx
{/* Time picker */}
<div className="flex items-center gap-1.5 text-xs text-[#6b6866]">
  <span>Send at</span>
  <input
    type="number"
    min={0}
    max={23}
    value={String(step.sendHour).padStart(2, "0")}
    onChange={(e) => {
      const v = parseInt(e.target.value, 10);
      updateStep(step.key, { sendHour: isNaN(v) ? 9 : Math.min(23, Math.max(0, v)) });
    }}
    className="w-10 border border-[#e5e3df] rounded px-1.5 py-1 text-center font-mono text-sm text-[#111110] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] bg-white"
  />
  <span className="font-mono text-[#6b6866]">:</span>
  <input
    type="number"
    min={0}
    max={59}
    value={String(step.sendMinute).padStart(2, "0")}
    onChange={(e) => {
      const v = parseInt(e.target.value, 10);
      updateStep(step.key, { sendMinute: isNaN(v) ? 0 : Math.min(59, Math.max(0, v)) });
    }}
    className="w-10 border border-[#e5e3df] rounded px-1.5 py-1 text-center font-mono text-sm text-[#111110] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] bg-white"
  />
</div>
```

- [ ] **Step 3: Include sendHour/sendMinute in the POST payload**

Find the `handleSave` function's `payload` construction and update each step mapping:

```typescript
steps: steps.map((s, i) => ({
  stepNumber: i + 1,
  dayOffset: s.dayOffset,
  channel: s.channel,
  templateId: s.templateId,
  subject: s.channel === "EMAIL" ? s.subject.trim() : undefined,
  sendHour: s.sendHour,
  sendMinute: s.sendMinute,
})),
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "new-sequence-modal" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/new-sequence-modal.tsx
git commit -m "feat: add sendHour/sendMinute time picker to sequence builder modal"
```

---

## Task 6: Update Sequence Detail — Show Scheduled Time

**Files:**
- Modify: `components/dashboard/sequence-detail-client.tsx`

- [ ] **Step 1: Add `scheduledAt` to the `StepExecution` type**

Find the `type StepExecution` and add the field:

```typescript
type StepExecution = {
  status: string;
  sentAt: Date | string | null;
  scheduledAt: Date | string | null;
  step: { stepNumber: number; channel: string; dayOffset: number };
};
```

- [ ] **Step 2: Add `formatScheduled` helper**

Add this helper function near the top of the file, after the `EXEC_COLORS` map:

```typescript
function formatScheduled(scheduledAt: Date | string | null): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  const dateStr = d.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const timeStr = d.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) return `${dateStr} ${timeStr} (מאוחר)`;
  const diffH = Math.round(diffMs / 3_600_000);
  if (diffH < 24) return `${dateStr} ${timeStr} (בעוד ${diffH} שעות)`;
  const diffDays = Math.round(diffMs / 86_400_000);
  return `${dateStr} ${timeStr} (בעוד ${diffDays} ימים)`;
}
```

- [ ] **Step 3: Update the execution cell rendering**

Find the part of the JSX where execution status is displayed in the contacts table. It currently looks like:

```tsx
{exec ? (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${EXEC_COLORS[exec.status] ?? ""}`}>
    {exec.status}
  </span>
) : (
  <span className="text-[#c8c5c2] text-xs">—</span>
)}
```

Replace with:

```tsx
{exec ? (
  <div className="flex flex-col items-center gap-0.5">
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${EXEC_COLORS[exec.status] ?? ""}`}>
      {exec.status}
    </span>
    {exec.status === "PENDING" && exec.scheduledAt && (
      <span className="text-[10px] text-[#9b9895] whitespace-nowrap">
        {formatScheduled(exec.scheduledAt)}
      </span>
    )}
    {exec.status === "SENT" && exec.sentAt && (
      <span className="text-[10px] text-[#9b9895] whitespace-nowrap">
        {new Date(exec.sentAt).toLocaleDateString("he-IL", {
          day: "2-digit",
          month: "2-digit",
          timeZone: "Asia/Jerusalem",
        })}{" "}
        {new Date(exec.sentAt).toLocaleTimeString("he-IL", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jerusalem",
        })}
      </span>
    )}
  </div>
) : (
  <span className="text-[#c8c5c2] text-xs">—</span>
)}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "sequence-detail" | head -10
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/sequence-detail-client.tsx
git commit -m "feat: show scheduled send time on PENDING executions in sequence detail"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| `sendHour`/`sendMinute` on `SequenceStep` | Task 1 |
| `computeScheduledAt` uses `date-fns-tz` + `Asia/Jerusalem` | Task 2 |
| `parseSteps` validates sendHour (0-23), sendMinute (0-59) | Task 2 |
| sequence-start passes hour/minute | Task 3 |
| sequence-tick passes hour/minute for new enrollments | Task 3 |
| maybeAdvance passes hour/minute for next step | Task 3 |
| `scheduledAt` in execution select | Task 4 |
| Time picker in modal builder | Task 5 |
| PENDING shows "22/05 09:30 (בעוד 14 שעות)" | Task 6 |
| SENT shows sent datetime | Task 6 |

### Placeholder Scan

No TBD/TODO/placeholder patterns found.

### Type Consistency

- `computeScheduledAt(enrolledAt, dayOffset, sendHour, sendMinute)` — consistent across helpers.ts, sequence-start.ts, sequence-tick.ts, maybeAdvance
- `ParsedStep` gains `sendHour: number` and `sendMinute: number` — consistent with parseSteps return and API route usage
- `StepExecution.scheduledAt: Date | string | null` — consistent with API route select and formatScheduled input
