# Outreach Campaigns — Design

**Status:** Draft, awaiting review
**Date:** 2026-05-19
**Scope:** Phase 1 detailed (LinkedIn). Phases 2 (Email) and 3 (WhatsApp) outlined for forward compatibility.

## Goal

Let a user filter their contacts (e.g. *"CTOs at companies sized 10–300"*), pick a message template, hit **Send**, and have the app deliver that message to every matched contact via LinkedIn — throttled, tracked, and resumable.

Later phases reuse the same engine for Email (via Apollo-enriched addresses) and WhatsApp.

## Non-goals

- AI-driven send decisions. Templates only (with variable substitution).
- Replying to inbound LinkedIn messages. Reply detection is later (phase 1.5).
- A/B testing, drip sequences, follow-ups. Single send per recipient per campaign.
- Cross-tenant sharing of templates or campaigns.

## Phase 1 — LinkedIn

### User flow

1. On the contacts page, the user applies filters and selects recipients (filter snapshot or explicit list).
2. Clicks **New Campaign** → modal with: name, template picker (from existing `MessageTemplate`), channel = LinkedIn (fixed in phase 1), preview of variable substitution on the first contact.
3. Confirms — campaign is created in `QUEUED` state. Inngest fan-out begins.
4. A campaign detail page shows per-recipient status (queued / sent / failed / skipped) and aggregate counters, updating live.
5. User can **pause** or **cancel** a running campaign.

### Data model (additions to `prisma/schema.prisma`)

```prisma
enum CampaignChannel { LINKEDIN EMAIL WHATSAPP }
enum CampaignStatus  { DRAFT QUEUED RUNNING PAUSED COMPLETED CANCELLED }
enum RecipientStatus { PENDING SENDING SENT FAILED SKIPPED }

model Campaign {
  id          String           @id @default(cuid())
  ownerId     String
  orgId       String?
  name        String
  channel     CampaignChannel  // phase 1: always LINKEDIN
  templateId  String
  status      CampaignStatus   @default(DRAFT)
  filterJson  Json?            // snapshot of the audience filter for audit
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
  id           String           @id @default(cuid())
  campaignId   String
  contactId    String
  status       RecipientStatus  @default(PENDING)
  renderedBody String?          // body after variable substitution
  sentMessageId String?         @unique // links to SentMessage when SENT
  errorMessage String?
  attemptCount Int              @default(0)
  scheduledAt  DateTime?        // for jittered scheduling
  sentAt       DateTime?

  campaign     Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contact      Contact      @relation(fields: [contactId], references: [id])
  sentMessage  SentMessage? @relation(fields: [sentMessageId], references: [id])

  @@unique([campaignId, contactId])
  @@index([campaignId, status])
}
```

Reuses existing `MessageTemplate` and `SentMessage`. Each successful send still writes a `SentMessage` row; `CampaignRecipient.sentMessageId` links them so historical search keeps working.

### LinkedIn send module

New file `lib/linkedin/send-message.ts`:

```ts
export async function sendLinkedInMessage(args: {
  userId: string;              // tenant whose cookie we use
  recipientProfileUrl: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; reason: "rate_limit" | "not_connected" | "unknown"; detail: string }>;
```

Implementation: extends the existing `lib/linkedin/mcp-client.ts` child-process pattern by adding a new Python entry point alongside `connections_scraper.py` / `profile_scraper.py` — `message_sender.py`. It:

- Loads the per-user encrypted cookie via the same path the connections scraper uses.
- Opens the profile via the existing Patchright/browserless Chromium session.
- Clicks **Message**, fills the textarea, presses **Send**. Detects (a) "You can't message this user" → `not_connected`, (b) captcha / restricted → `rate_limit`.
- Returns structured JSON over stdout (same protocol as existing scrapers).

Resolution of `recipientProfileUrl`: comes from `Contact.profileUrl` (already populated by the connections sync).

### Throttling

Per-user limits enforced via Upstash Redis:
- **Hard cap:** 20 LinkedIn messages per rolling hour per LinkedIn account.
- **Soft cap:** 80 per rolling 24h.
- **Jitter:** 45–120s between sends within a campaign for the same user.

When a cap is hit, the recipient's `scheduledAt` is bumped and re-emitted; the campaign stays in `RUNNING`.

Rate-limit detection from LinkedIn (`reason: "rate_limit"`) escalates: the user's LinkedIn session is paused for 12h, all their `RUNNING` campaigns transition to `PAUSED`, and an in-app warning surfaces. Manual resume only.

### Inngest functions

In `inngest/functions/`:

- **`campaign.start`** — Triggered by API `POST /api/campaigns/:id/start`. Resolves the audience (either the saved filter or the snapshot list), creates `CampaignRecipient` rows in `PENDING`, renders bodies (template variable substitution), transitions campaign to `RUNNING`, and emits one `campaign.send-one` event per recipient with a jittered `scheduledAt`.
- **`campaign.send-one`** — Throttled by Inngest's `throttle` config (per-user key, matching the Upstash limits as a defense-in-depth). Calls `sendLinkedInMessage`. On success: writes `SentMessage`, links it on the recipient, sets `SENT`. On failure: increments `attemptCount`, retries up to 2 with exponential backoff, then `FAILED`. On `rate_limit`: pauses the campaign (see above).
- **`campaign.finalize`** — Periodic fan-in: when no `PENDING` or `SENDING` recipients remain, mark the campaign `COMPLETED` and set `completedAt`.

### Template variables

Phase 1 supports two variable groups:

**Recipient variables** (from `Contact`): `{{firstName}}`, `{{lastName}}`, `{{company}}`, `{{title}}`.

**Sender variables** (from the `User` who started the campaign): `{{senderFirstName}}`, `{{senderLastName}}`, `{{senderTitle}}`, `{{senderCompany}}`. This lets a shared org template ("Hi {{firstName}}, this is {{senderFirstName}} from {{senderCompany}}…") render with each team member's own name when they run it.

Substitution happens once at campaign start (stored on `CampaignRecipient.renderedBody`) so the user sees exactly what was sent even if the contact or sender profile later changes.

Missing variables fall back to a configurable default per variable (e.g. `{{firstName|there}}`). If no fallback and no value, the recipient is `SKIPPED` with reason `missing_variable:firstName`. Sender variables with no value resolve to empty string (no skip — a missing senderTitle shouldn't block a send).

`User` may need a `title` field added if not already present (check schema during implementation).

### API surface

- `POST /api/campaigns` — create draft (name, templateId, channel, filterJson or contactIds[])
- `GET /api/campaigns` — list user's campaigns
- `GET /api/campaigns/:id` — detail + paginated recipients
- `POST /api/campaigns/:id/start` — transition DRAFT → QUEUED, dispatch Inngest event
- `POST /api/campaigns/:id/pause` / `resume` / `cancel`
- All wrapped in `withTenant` (existing pattern from `lib/tenancy/with-tenant.ts`).

### UI

- **`app/(dashboard)/campaigns/`** — list page (server component + client filters)
- **`app/(dashboard)/campaigns/[id]/`** — detail with live-updating recipient table (SSE via existing `lib/linkedin/sse-bus.ts`)
- **`components/dashboard/new-campaign-modal.tsx`** — modal triggered from contacts page's existing `bulk-enrich-bar.tsx`. Adds a **Send Campaign** action next to **Send Message**.
- The existing one-off **Send Message** drawer stays — it's the manual single-send path. The campaign modal is bulk.

### Failure modes & recovery

- **Browserless connection drop mid-send:** `campaign.send-one` is idempotent on `(campaignId, contactId)`. The Inngest retry re-attempts; if the message was already sent on LinkedIn but we didn't record it, the worst case is a duplicate. We accept this risk for v1 (LinkedIn de-duplicates identical recent messages on the same thread anyway).
- **User revokes LinkedIn cookie:** sender returns a distinct `not_authenticated` reason → campaign `PAUSED` + actionable UI prompt.
- **Contact deleted mid-campaign:** recipient → `SKIPPED` with reason `contact_deleted`.

### Observability

- Per-campaign metrics in the detail page: queued, sent, failed, skipped, time-to-complete.
- `AuditEvent` row written on campaign create, start, pause, resume, cancel, and on every rate-limit-triggered pause.
- Existing admin view (`app/(dashboard)/admin/`) gets a "Campaigns" tab showing org-wide volume + error rate.

### Out of scope for phase 1

- Reply detection / inbox sync. (Phase 1.5 — uses existing MCP `get_inbox` tool, polled hourly.)
- Connection-request sends (`connect_with_person`). Same engine, separate channel later.
- Sending from non-1st-degree contacts (LinkedIn requires connection first).

## Phase 2 — Email

Reuses the campaign engine. Additions:

- New `CampaignChannel.EMAIL` path.
- `lib/email/send.ts` using Resend (transactional) — needs a verified sending domain per org.
- **Apollo enrichment on demand:** when a campaign with `channel = EMAIL` starts, for each recipient missing `Contact.email`, call Apollo's `people/match` once and cache the result on `Contact.email` + `Contact.emailEnrichedAt`. Never speculatively enrich.
- Apollo credit guard: refuse to start the campaign if `recipientsNeedingEnrichment * 1 credit > org.apolloCreditBudget`. UI shows estimated credit cost before send.
- Throttling: 200/hour per sending domain (Resend default).
- Bounce/complaint webhooks → recipient `FAILED` with reason from Resend.

Schema deltas: add `email`, `emailEnrichedAt`, `emailVerificationStatus` to `Contact`.

## Phase 3 — WhatsApp

Reuses the engine. Additions:

- `CampaignChannel.WHATSAPP` path.
- Phone enrichment via Apollo (same credit-guard pattern). Adds `phone`, `phoneEnrichedAt` to `Contact`.
- Sender: WhatsApp Business Cloud API (Meta). Requires approved message templates per channel — campaign template must be linked to a pre-approved WA template ID.
- Stricter rate limits — WA Business tier limits apply per phone number (1K/24h for new senders).

## Testing strategy

- **Unit:** template substitution, throttle math, rate-limit-reason classifier.
- **Integration (Vitest + real Postgres):** campaign lifecycle transitions, recipient state machine, Inngest event payloads.
- **E2E (Playwright):** create campaign → mock-mode sender → verify UI status updates.
- **Mock sender:** `lib/linkedin/send-message.ts` honors `LINKEDIN_SEND_MODE=mock` to write `SentMessage` rows without touching LinkedIn. Used in dev and CI; mandatory for any automated test.

## Open questions

None blocking phase 1. Phase 2 deferred questions: which Apollo endpoint (`people/match` vs `people/bulk_match`), and whether to require domain verification before allowing email campaigns at all.
