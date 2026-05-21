# Sequence Send Time Design

**Date:** 2026-05-21
**Feature:** Per-step send time (hour + minute) for sequences, with Israel timezone support and scheduled-time visibility in the UI.

---

## Problem

Currently `SequenceStepExecution.scheduledAt` is computed as `enrolledAt + dayOffset days` at midnight UTC. The user has no control over what time of day messages are sent, and PENDING executions show no scheduled time — the user cannot tell if "PENDING" means "in 5 minutes" or "tomorrow morning".

---

## Solution Overview

1. Add `sendHour` and `sendMinute` to `SequenceStep` so each step has its own send time.
2. Update `computeScheduledAt` to compute an exact UTC timestamp from the enrollment date, day offset, and Israel local time.
3. Update all callers of `computeScheduledAt` to pass the new fields.
4. Show scheduled time on PENDING executions in the detail UI.
5. Add a time picker per step in the sequence builder modal.

---

## Data Model

### `SequenceStep` — two new fields

```prisma
sendHour   Int @default(9)   // 0–23, Israel local time
sendMinute Int @default(0)   // 0–59, Israel local time
```

No changes to `SequenceStepExecution` — `scheduledAt DateTime` already stores the precise UTC moment.

---

## Scheduling Logic

### `computeScheduledAt` — updated signature

```typescript
computeScheduledAt(
  enrolledAt: Date,
  dayOffset: number,
  sendHour: number,
  sendMinute: number
): Date
```

**Algorithm:**
1. Take `enrolledAt` and add `dayOffset` calendar days to get the target date.
2. Construct a wall-clock datetime string: `"YYYY-MM-DD HH:MM:00"` in `Asia/Jerusalem`.
3. Convert to UTC using `date-fns-tz`'s `fromZonedTime` (formerly `zonedTimeToUtc`).
4. Return the resulting UTC `Date`.

**Why `date-fns-tz`:** It handles Israel's DST transitions (UTC+2 winter, UTC+3 summer) correctly without manual offset management.

**Example:**
- `enrolledAt = 2026-05-21 10:00 UTC`, `dayOffset = 2`, `sendHour = 9`, `sendMinute = 30`
- Target date: `2026-05-23`
- Israel wall clock: `2026-05-23 09:30 Asia/Jerusalem` (UTC+3 in May)
- Result: `2026-05-23 06:30:00 UTC`

### Callers to update

| Location | Change |
|----------|--------|
| `lib/sequences/helpers.ts` | Updated `computeScheduledAt` signature + `date-fns-tz` logic |
| `inngest/functions/sequence-start.ts` | Pass `firstStep.sendHour`, `firstStep.sendMinute` |
| `inngest/functions/sequence-tick.ts` | Pass `firstStep.sendHour`, `firstStep.sendMinute` for new enrollments |
| `inngest/functions/sequence-send-execution.ts` (`maybeAdvance`) | Pass `nextStep.sendHour`, `nextStep.sendMinute` |

### `sequence-tick` precision

The tick runs hourly. A message due at 09:30 will be dispatched at the tick running between 09:00 and 10:00 Israel time — worst case 30 minutes late, acceptable for a day-level scheduling tool.

---

## API Changes

### `POST /api/sequences` — create

Request body `steps` array now accepts `sendHour` and `sendMinute`:
```json
{
  "stepNumber": 1,
  "dayOffset": 0,
  "channel": "EMAIL",
  "templateId": "...",
  "subject": "Hi",
  "sendHour": 9,
  "sendMinute": 30
}
```

`parseSteps` in `lib/sequences/helpers.ts` updated to:
- Accept `sendHour` (integer 0–23, default 9 if missing)
- Accept `sendMinute` (integer 0–59, default 0 if missing)
- Reject non-integer or out-of-range values

### `GET /api/sequences/[id]` — detail

Execution select must include `scheduledAt` so the UI can display it:
```typescript
executions: {
  select: {
    status: true,
    sentAt: true,
    scheduledAt: true,   // ← add this
    step: { select: { stepNumber: true, channel: true } }
  }
}
```

---

## UI Changes

### New Sequence Modal — step card

Each step card gains a time picker between the day offset controls and the channel toggle:

```
Step 1                              Day [▼1▲]  [09]:[30]  🗑
[EMAIL]  [WhatsApp]
Subject line: ________________
Template: [dropdown]
```

- Two number inputs: hour (00–23) and minute (00–59), separated by `:`
- Default: `09:00`
- Validation: hour 0–23, minute 0–59 (integers only)

### Sequence Detail — Contacts table

Each step column now shows full status with scheduled time:

| Status | Display |
|--------|---------|
| SENT | `✓ SENT · 22/05 09:30` |
| PENDING (future) | `PENDING · 22/05 09:30 (בעוד 14 שעות)` |
| PENDING (overdue) | `PENDING · 22/05 09:30 (מאוחר)` |
| FAILED | `✗ FAILED` |
| SKIPPED | `SKIPPED` |
| Not yet created | `—` |

**Countdown logic (client-side):**
```typescript
function formatScheduled(scheduledAt: Date | string): string {
  const d = new Date(scheduledAt);
  const diffMs = d.getTime() - Date.now();
  const diffH = Math.round(diffMs / 3_600_000);
  const dateStr = d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
  const timeStr = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  if (diffMs < 0) return `${dateStr} ${timeStr} (מאוחר)`;
  if (diffH < 24) return `${dateStr} ${timeStr} (בעוד ${diffH} שעות)`;
  const diffDays = Math.round(diffMs / 86_400_000);
  return `${dateStr} ${timeStr} (בעוד ${diffDays} ימים)`;
}
```

---

## File Map

| Action | Path |
|--------|------|
| Modify | `prisma/schema.prisma` — add `sendHour`, `sendMinute` to `SequenceStep` |
| Create | `prisma/migrations/…_add_step_send_time` |
| Modify | `lib/sequences/helpers.ts` — update `computeScheduledAt`, `parseSteps` |
| Modify | `tests/unit/sequences-helpers.test.ts` — update tests for new signature |
| Modify | `inngest/functions/sequence-start.ts` |
| Modify | `inngest/functions/sequence-tick.ts` |
| Modify | `inngest/functions/sequence-send-execution.ts` (`maybeAdvance`) |
| Modify | `app/api/sequences/[id]/route.ts` — add `scheduledAt` to execution select |
| Modify | `components/dashboard/new-sequence-modal.tsx` — add time picker |
| Modify | `components/dashboard/sequence-detail-client.tsx` — show scheduled time |

---

## Dependencies

`date-fns-tz` — check if already installed. If not, add via `npm install date-fns-tz`.

---

## Out of Scope

- Per-user timezone settings (always `Asia/Jerusalem`)
- Weekday restrictions (no sending on weekends)
- Sub-minute precision
- Editing send time on a running sequence (only on DRAFT)
