@AGENTS.md

## Architecture

Multi-tenant LinkedIn sales intelligence platform. See README.md for full architecture, data model, and key flows.

## Tenancy rules (MUST follow)

- Every API route MUST be wrapped with `withTenant()` from `lib/tenancy/with-tenant.ts`
- Never use raw `prisma` in route handlers for Contact/SentMessage queries — always filter by `ctx.effectiveUserId`
- `scopedPrisma()` is available for read-heavy pages that need automatic row-level isolation

## Module conventions

- New service clients go in `lib/<service>/client.ts`
- New Inngest functions go in `inngest/functions/<name>.ts` and must be registered in `app/api/inngest/route.ts`
- Inngest event names are string literals typed inline — search existing functions for the pattern
- Scripts that touch the DB go in `scripts/` and use `tsx scripts/<name>.ts` to run

## Inngest event index

| Event | Trigger | Function file |
|---|---|---|
| `enrich.contact` | manual / bulk trigger | `inngest/functions/enrich-contact.ts` |
| `contacts.enrich-haiku` | after CSV import | `inngest/functions/enrich-contacts-haiku.ts` |
| `companies.enrich` | after sync | `inngest/functions/enrich-companies.ts` |
| `companies.enrich-web` | after CSV import | `inngest/functions/enrich-companies-web.ts` |
| `campaign.start` | campaign start API | `inngest/functions/campaign-start.ts` |
| `campaign.send-one` | per recipient | `inngest/functions/campaign-send-one.ts` |
| `campaign.finalize` | after all sent | `inngest/functions/campaign-finalize.ts` |
| `sequence.start` | sequence start API | `inngest/functions/sequence-start.ts` |
| `sequence.tick` | cron / admin trigger | `inngest/functions/sequence-tick.ts` |
| `sequence.send-execution` | per step due | `inngest/functions/sequence-send-execution.ts` |

## Next.js version

Read `node_modules/next/dist/docs/` before writing any Next.js code.
This version has breaking changes from training data.
