# WhatsApp Campaign Integration — Design Spec

**Date:** 2026-05-20  
**Status:** Approved

---

## Overview

Add WhatsApp as a campaign channel alongside LinkedIn. Each user connects their personal WhatsApp number via QR code scan in the dashboard. Campaigns use the existing template system and Inngest job architecture, with a configurable daily send limit per campaign.

---

## Architecture

A Node.js sidecar service (`whatsapp-service/`) runs alongside Next.js, mirroring the existing LinkedIn MCP server pattern. It owns all Baileys WebSocket connections (one per user) and exposes a simple HTTP API that Next.js calls.

```
Next.js app  ──HTTP──►  WhatsApp sidecar  ──WebSocket──►  WhatsApp servers
                              │
                    whatsapp-sessions/<userId>/   (Baileys auth files on disk)
```

**Sidecar HTTP endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/session/:userId/status` | Returns `CONNECTED \| QR_PENDING \| DISCONNECTED` |
| `GET` | `/session/:userId/qr` | SSE stream — emits base64 QR image on each new code (~20s refresh) |
| `POST` | `/session/:userId/disconnect` | Disconnects and removes session files |
| `POST` | `/send` | `{ userId, phone, body }` → sends message, returns `{ messageId }` |

On startup, the sidecar scans `whatsapp-sessions/` and restores any existing sessions automatically.

**Next.js proxy routes:**

| Route | Proxies to |
|-------|-----------|
| `GET /api/whatsapp/status` | Sidecar session status |
| `GET /api/whatsapp/qr` | Sidecar QR SSE stream |
| `POST /api/whatsapp/disconnect` | Sidecar disconnect |

---

## Data Model

### Campaign — add `dailyLimit`

```prisma
dailyLimit  Int?   // null = org default (100/day)
```

No new session model — Baileys auth state lives on disk under `whatsapp-sessions/<userId>/`.

### Contact

No changes. Existing `phone` field used as the send target. Recipients with no `phone` are SKIPPED at campaign start with reason `"no phone number"`.

### CampaignRecipient

No changes. Existing `PENDING → SENDING → SENT/FAILED/SKIPPED` flow works as-is.

### Migration

```sql
ALTER TABLE "Campaign" ADD COLUMN "dailyLimit" INTEGER;
```

---

## Campaign Sending

A new Inngest function `campaign-send-whatsapp` (triggered by `campaign.send-one` events for WHATSAPP channel campaigns) handles WhatsApp sends:

1. Check daily quota against campaign `dailyLimit` (default 100) using existing Redis throttle pattern
2. If quota reached, reschedule for next day
3. Normalize phone number to E.164 format
4. If unparseable, mark recipient FAILED with `"invalid phone number"`
5. Call sidecar `POST /send`
6. On 200: create SentMessage, mark recipient SENT
7. On 401 (session disconnected): mark recipient FAILED, continue campaign
8. On 5xx: retry up to 3 times with existing backoff, then mark FAILED

The existing `campaign-start` function resolves audience and enqueues `campaign.send-one` events — no changes needed there. Both the existing `campaignSendOne` (LinkedIn) and the new `campaignSendWhatsapp` function listen to the `campaign.send-one` event; each checks `campaign.channel` at the top and returns early if it's not their channel. This avoids modifying the existing LinkedIn function.

**Rate limiting:** same Inngest throttle as LinkedIn (`lib/campaigns/throttle.ts`) but respects `campaign.dailyLimit` instead of the hardcoded org limit.

---

## Template System

No changes. Existing `{{firstName}}`, `{{lastName}}`, `{{company}}`, `{{title}}` variables work for WhatsApp campaigns. Rendering logic in `lib/campaigns/render-template.ts` is channel-agnostic.

---

## UI

### 1. WhatsApp Connect page — `/dashboard/whatsapp-connect`

- Shows connection status badge: `Connected (+ phone number)` or `Disconnected`
- If disconnected: displays QR code image (auto-refreshes via SSE every ~20s) with instructions to scan from WhatsApp on phone
- Disconnect button when connected
- Linked from sidebar

### 2. Sidebar

- Add WhatsApp entry with a green/red status dot (same pattern as LinkedIn connection indicator)

### 3. New Campaign Modal

- Add channel selector step: LinkedIn | WhatsApp
- If WhatsApp selected and session is not CONNECTED: show warning banner with link to connect page
- Add "Daily limit" number input (default: 100, min: 10, max: 500) — only visible for WhatsApp channel

### 4. Campaign Detail page

No changes. Existing status badges, recipient table, and start/pause/cancel controls work for WhatsApp campaigns.

---

## Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Connection drops mid-campaign | Baileys auto-reconnects; Inngest retries on 503 up to 3×; campaign stays RUNNING and resumes when reconnected |
| QR code expires | Sidecar emits new QR via SSE; UI re-renders automatically |
| No phone number on contact | Marked SKIPPED at campaign start: `"no phone number"` |
| Unparseable phone format | Marked FAILED: `"invalid phone number"` |
| Daily limit reached | Inngest reschedules recipient send for next day; campaign stays RUNNING |
| Session disconnected during send | Marked FAILED; campaign continues with remaining recipients; user reconnects and resumes |

---

## Out of Scope

- Media attachments (images, documents, voice notes)
- WhatsApp Business API
- Group messaging
- Read receipts / delivery tracking beyond SENT status
