@AGENTS.md

## Architecture

Multi-tenant LinkedIn sales intelligence platform. See README.md for full architecture, data model, and key flows.

## Tenancy rules (MUST follow)

- Every API route MUST be wrapped with `withTenant()` from `lib/tenancy/with-tenant.ts`
- Never use raw `prisma` in route handlers for Contact/SentMessage queries — always filter by `ctx.effectiveUserId`

## UI library

Use HeroUI (`@heroui/react`) for all React components.

## Module conventions

- New service clients go in `lib/<service>/client.ts`
- New Inngest functions go in `inngest/functions/<name>.ts` and must be registered in `app/api/inngest/route.ts`
- Inngest event names are string literals typed inline — search existing functions for the pattern
- Scripts that touch the DB go in `scripts/` and use `tsx scripts/<name>.ts` to run

## Inngest event index

| Event | Trigger | Function file |
|---|---|---|
| `enrich.contact` | manual / bulk trigger | `inngest/functions/enrich-contact.ts` |
| `enrichment.propagate` | after any successful enrich | `inngest/functions/enrichment-propagate.ts` |
| `contacts.enrich-hebrew-names` | after CSV import | `inngest/functions/enrich-contacts-hebrew-names.ts` |
| `companies.enrich` | after sync | `inngest/functions/enrich-companies.ts` |
| `companies.enrich-web` | after CSV import | `inngest/functions/enrich-companies-web.ts` |
| `campaign.start` | campaign start API | `inngest/functions/campaign-start.ts` |
| `campaign.send-one` | per recipient | `inngest/functions/campaign-send-one.ts` |
| `campaign.send-email` | per recipient (email) | `inngest/functions/campaign-send-email.ts` |
| `campaign.send-whatsapp` | per recipient (WhatsApp) | `inngest/functions/campaign-send-whatsapp.ts` |
| `campaign.finalize` | after all sent | `inngest/functions/campaign-finalize.ts` |
| `sequence.start` | sequence start API | `inngest/functions/sequence-start.ts` |
| `sequence.tick` | cron / admin trigger | `inngest/functions/sequence-tick.ts` |
| `sequence.send-execution` | per step due | `inngest/functions/sequence-send-execution.ts` |
| `prospecting.start` | prospecting start API | `inngest/functions/prospecting-start.ts` |
| `prospecting.tick` | cron */5 * * * * | `inngest/functions/prospecting-tick.ts` |
| `import.process` | CSV upload API | `inngest/functions/import-process.ts` |
| `job.check` | nightly cron dispatch | `inngest/functions/job-check-contact.ts (+ lib/job-check/detect-change.ts)` |
| *(cron 0 2 \* \* \*)* | nightly job-change batch trigger | `inngest/functions/job-check-tick.ts` |
| *(cron 0 3 \* \* \*)* | daily Apollo→HubSpot sync | `inngest/functions/hubspot-sync-apollo.ts` |
| *(cron 0 3 \* \* \*)* | daily Bright Data priority job-check trigger | `inngest/functions/brightdata-job-check-tick.ts` |
| `brightdata.job-check.collect` | after tick triggers a snapshot | `inngest/functions/brightdata-job-check-collect.ts` |

## Next.js version

Read `node_modules/next/dist/docs/` before writing any Next.js code.
This version has breaking changes from training data.
