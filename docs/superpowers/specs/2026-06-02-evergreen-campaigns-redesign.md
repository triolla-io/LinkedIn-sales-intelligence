# Evergreen Campaigns Redesign

**Date:** 2026-06-02  
**Status:** Approved

## Overview

Replace the current one-shot Campaign module with an evergreen, multi-channel drip campaign system. Each contact enrolled in a campaign receives a personal timeline that starts from the moment they join — not a fixed broadcast date. Contacts can be enrolled via a linked list (auto-enroll as new members are added) or manually at any time.

## Architecture

### Reuse Sequences backend as-is

The existing Sequences infrastructure already implements the correct model:

| UI (user sees) | DB (existing table) |
|---|---|
| Campaign | Sequence |
| Campaign Step | SequenceStep |
| Enrollment (contact in campaign) | SequenceEnrollment |
| Step execution | SequenceStepExecution |

No DB table renames required. All Inngest functions (`sequence-start`, `sequence-tick`, `sequence-send-execution`) remain unchanged.

### One schema addition

Add `sendHourEnd` (Int?) to `SequenceStep` to support a time window for sending (e.g., between 09:00 and 17:00). The existing `sendHour` becomes the start of the window.

### API changes

- **New:** `POST /api/sequences/[id]/enrollments` — manually enroll one or more contacts into a sequence. Sets `enrolledAt = now()` and creates pending `SequenceStepExecution` for step 1.
- **Existing:** `DELETE /api/sequences/[id]/enrollments/remove` — already implemented, no change needed.
- **Existing:** All other sequence routes (`/start`, `/pause`, `/cancel`, `/resume`) remain unchanged.
- **Retire:** All `/api/campaigns` routes (old one-shot campaigns) — remove from UI and routing. Keep DB tables in place to avoid data loss.

## Campaign Creation UI

A single-page builder with three areas:

### Area 1 — Campaign Details
- Campaign name (free text, required)
- Linked list (dropdown from existing Lists — optional; enables auto-enrollment of new list members)

### Area 2 — Steps Builder

Chronological step cards, each containing:
- **Channel** — dropdown: Email / LinkedIn / WhatsApp
- **Template** — dropdown filtered by channel
- **Send after** — number input (days since enrollment, ≥ 0)
- **Send between** — time range: start hour and end hour (e.g., 08:00–18:00)

Constraints enforced at creation time:
- `dayOffset` of each step must be strictly greater than the previous step
- At least one step required before saving
- Template required per step

Interactions:
- Steps can be reordered via drag-and-drop
- Steps can be deleted (with confirmation if campaign is active)
- "+ Add Step" button appends a new empty step card

### Area 3 — Actions
- **Save as Draft** — saves without activating
- **Save & Activate** — saves then calls `/start`, which triggers `sequence-tick` enrollment

## Campaign Detail Page

### Header
- Campaign name + status badge (DRAFT / ACTIVE / PAUSED / COMPLETED / CANCELLED)
- Action buttons: Pause / Resume / Cancel / Edit (navigates back to builder)

### Summary Cards
Four metric cards:
- Total enrolled
- Completed (all steps sent)
- In progress (active enrollment)
- Failed (any step with FAILED status)

### Manual Enrollment
- "+ Add Contacts" button opens the existing contact search drawer (multi-select)
- On confirm: calls `POST /api/sequences/[id]/enrollments` with selected contact IDs
- Each contact gets their own `enrolledAt = now()` and starts from step 1

### Enrollment Table

Columns: Name | Enrolled date | Current step | Next step (date) | Status

- **Next step date** is computed as `enrolledAt + dayOffset` of the next pending step
- Row action: Remove contact from campaign (calls existing `/remove` endpoint)
- Pagination if > 50 rows

## Navigation

Replace "Campaigns" menu item with the new evergreen Campaign list page (backed by Sequence data). Old Campaign list page is removed. The page title and all copy say "Campaigns" — no mention of "Sequences" in the UI.

## What Gets Removed

- `app/(dashboard)/campaigns/` — old campaign pages
- `app/api/campaigns/` — old campaign API routes
- Old Campaign/CampaignRecipient Inngest functions (`campaign-start`, `campaign-send-one`, `campaign-send-email`, `campaign-send-whatsapp`, `campaign-finalize`)
- DB tables (`Campaign`, `CampaignRecipient`) are left in place but no longer written to

## Out of Scope

- Migrating existing Campaign data to the new model
- A/B testing steps
- Exit conditions (e.g., stop if contact replies)
- Analytics beyond the four summary cards
