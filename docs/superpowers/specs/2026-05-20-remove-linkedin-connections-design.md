# Remove LinkedIn Connections — Design Spec

**Date:** 2026-05-20
**Status:** Approved

## Problem

The LinkedIn connection/sync integration is broken and will not be fixed. Contacts will come exclusively from CSV uploads. Campaigns will support WhatsApp and Email only. All LinkedIn API infrastructure must be removed cleanly without losing any existing contact data.

## Scope

### What we're removing
- LinkedIn session/cookie connection flow (OAuth, Browserless, manual cookie paste)
- Contact sync via LinkedIn MCP (full sync, delta sync, hourly cron)
- LinkedIn DM sending (send-message Inngest function, campaign-send-one LINKEDIN branch)
- Profile enrichment via LinkedIn MCP or Python scraper (profile-enrich, enrich-profiles)
- SSE real-time bus (all events were LinkedIn-specific)
- MCP/cookie infrastructure (mcp-client, mcp-http-client, cookie-crypto)
- LinkedIn status display from dashboard and admin pages

### What we're keeping
- All existing contact data (no destructive migrations on the Contact table)
- `linkedinUrn` / `linkedinUrl` field names on Contact (rename deferred to avoid data risk)
- CSV import flow (`/import`, `/api/import/csv`, `lib/csv/diff.ts`)
- Gemini-based company enrichment (`enrich-companies`, `enrich-companies-web`)
- Email enrichment (`enrich-contact`)
- Campaigns — kept, but LINKEDIN channel removed
- Contact table, filters, templates, saved views, enrichment spend tracking

## Database Migrations

Safe to run against production — no contact data is touched.

| Change | Risk |
|--------|------|
| Drop `LinkedinSession` table | Safe — session cookies only |
| Drop `SessionStatus` enum | Safe — only used by LinkedinSession |
| Drop `SyncJob` table | Safe — sync history logs only |
| Drop `SyncType` enum | Safe — only used by SyncJob |
| Remove `LINKEDIN` from `CampaignChannel` enum | Safe — no existing campaigns use this channel |
| Remove `Contact.connectedAt` column | Safe — populated from LinkedIn sync, stale/null |

**Field rename deferred:** `linkedinUrn` / `linkedinUrl` keep their names. Renaming requires `ALTER TABLE ... RENAME COLUMN` (not Prisma's default DROP+ADD). Deferred to a separate migration when there is no production data risk.

## Files to Delete

### Pages & routes
- `app/(dashboard)/linkedin-connect/page.tsx`
- `app/api/linkedin/connect/route.ts`
- `app/api/linkedin/connect/auto/route.ts`
- `app/api/linkedin/connect/complete/route.ts`
- `app/api/linkedin/connect/manual/route.ts`
- `app/api/linkedin/disconnect/route.ts`
- `app/api/linkedin/session/route.ts`
- `app/api/linkedin/status/route.ts`
- `app/api/sync/trigger/route.ts`
- `app/api/sync/status/route.ts`
- `app/api/messages/send/route.ts`

### Inngest functions
- `inngest/functions/sync-full.ts`
- `inngest/functions/sync-delta.ts`
- `inngest/functions/sync-cron.ts`
- `inngest/functions/send-message.ts`
- `inngest/functions/enrich-profiles.ts`
- `inngest/functions/profile-enrich.ts`

### Lib
- `lib/linkedin/cookie-crypto.ts`
- `lib/linkedin/mcp-client.ts`
- `lib/linkedin/mcp-http-client.ts`
- `lib/linkedin/sse-bus.ts`
- `scripts/bootstrap-cookie-cache.ts`

### Tests
- `tests/unit/cookie-crypto.test.ts`
- `tests/unit/mcp-client.test.ts`
- `tests/unit/slug-utils.test.ts` (moves with slug-utils)

## File to Move

`lib/linkedin/slug-utils.ts` → `lib/utils/slug-utils.ts`

The `slugifyCompany` function is used by the CSV import route and company enrichment. It has no LinkedIn dependency — it just normalises company names into URL slugs. Moving it out of the `linkedin/` folder; all importers updated.

## Files to Modify

### Prisma schema
- `prisma/schema.prisma` — apply all migration changes above

### Navigation & dashboard
- `components/dashboard/sidebar.tsx` — remove LinkedIn nav item *(already done)*
- `app/(dashboard)/dashboard/dashboard-client.tsx` — replace LinkedIn status card with recent import stats (uses existing `Import` model: fileName, added, updated, removed, createdAt)
- `app/(dashboard)/dashboard/page.tsx` — remove LinkedIn status data fetching, add latest Import query

### Inngest
- `inngest/client.ts` — remove LinkedIn/sync event type registrations (`sync.full`, `sync.delta`, `profiles.enrich`, `profile.enrich`, `message.send`)
- `inngest/functions/campaign-send-one.ts` — remove LINKEDIN channel branch

### Multi-tenant scoping
- `lib/tenancy/scoped-prisma.ts` — remove `linkedinSession` include from scoped user query

### Admin
- `app/api/admin/users/route.ts` — remove `linkedinSession` from user select, remove `linkedinStatus` / `lastValidatedAt` from response
- `app/(dashboard)/admin/admin-client.tsx` — remove LinkedIn status columns
- `app/(dashboard)/admin/users/page.tsx` — remove LinkedIn status display
- `app/(dashboard)/admin/[userId]/page.tsx` — remove LinkedIn status display

### Components (delete entirely)
- `components/dashboard/enrich-banner.tsx` — 100% LinkedIn SSE events; also connects to `/api/sse/stream` which does not exist (already broken)
- `components/dashboard/enrichment-progress.tsx` — 100% LinkedIn SSE events from `/api/sync/status` (being deleted)

### CSV & utils
- `app/api/import/csv/route.ts` — update slug-utils import path
- `lib/csv/diff.ts` — update slug-utils import path
- `prisma/backfill-contacts.ts` — update slug-utils import path
- `prisma/seed-companies.ts` — update slug-utils import path
- `tests/unit/csv-diff.test.ts` — update slug-utils import path if referenced

## Data Safety Summary

- **Contact rows:** untouched
- **Company rows:** untouched
- **Campaign/recipient rows:** untouched
- **Import rows:** untouched
- **Lost data:** LinkedIn session cookies (intentional), sync job history logs (intentional)
