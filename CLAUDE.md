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
- Every OpenRouter LLM call MUST go through `openrouterChat()` in `lib/openrouter/client.ts` (kill-switch + daily budget + cost logging) — never fetch openrouter.ai directly
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
| `prospecting.tick` | cron */15 * * * * | `inngest/functions/prospecting-tick.ts` |
| `import.process` | CSV upload API | `inngest/functions/import-process.ts` |
| *(cron 0 2 \* \* \*)* | nightly job-change batch trigger — dispatches `SCRAPE_PROFILE` extension tasks (customer's LinkedIn via the extension, no Apollo/Bright Data spend) | `inngest/functions/job-check-tick.ts` |
| `job-check.enabled` | "Job Changes" module toggled ON (kick-on-enable dispatch) | `inngest/functions/job-check-dispatch.ts` |
| *(cron 0 3 \* \* \*)* | daily Apollo→HubSpot sync | `inngest/functions/hubspot-sync-apollo.ts` |
| `company.signals.enabled` | "Company signals" module toggled ON (kick-on-enable dispatch) | `inngest/functions/company-signals-dispatch.ts` |
| `company.signals.detect` | weekly tick / kick-on-enable | `inngest/functions/company-signals-detect.ts` |
| `company.signals.draft` | after a verified signal is detected | `inngest/functions/company-signals-draft.ts` |
| *(cron 0 4 \* \* \*)* | daily company-signals trigger (28 companies/day, 7-day cooldown) | `inngest/functions/company-signals-tick.ts` |
| *(cron 0 5 \* \* 0)* | weekly fintech-news radar — fetch ~last-7-days topic news, chunk-tag, match to C-level contacts, draft engagement | `inngest/functions/fintech-radar-tick.ts` |
| `fintech.radar.enabled` | "Fintech Radar" module toggled ON (kick-on-enable: fetch + match for that org) | `inngest/functions/fintech-radar-dispatch.ts` |
| `fintech.radar.match` | per (org × new article) | `inngest/functions/fintech-radar-match.ts` |
| `fintech.radar.draft` | per new match | `inngest/functions/fintech-radar-draft.ts` |
| `tech-radar.company.research` | company added to the tracked list / "research again" / quarterly refresh | `inngest/functions/tech-radar-research.ts` |
| *(cron 0 6 \* \* 0)* | weekly Tech Radar scan — one canonical query pool per org, shared triage + write-ups, per-company fit | `inngest/functions/tech-radar-tick.ts` |
| *(cron 0 7 \* \* 0)* | quarterly tracked-company profile refresh (stale > 90 days) | `inngest/functions/tech-radar-tick.ts` |
| `tech-radar.scan` | weekly tick / kick-on-enable | `inngest/functions/tech-radar-scan.ts` |
| `tech-radar.draft` | per new opportunity | `inngest/functions/tech-radar-draft.ts` |
| `tech-radar.enabled` | "Tech Radar" module toggled ON (kick-on-enable) | `inngest/functions/tech-radar-dispatch.ts` |
| `radar.build-profiles` | manual — build the person model (profiles + axes) and STOP, so the axis count can be read before any search is paid for | `inngest/functions/radar-build-profiles.ts` |
| `radar.judge` | manual — rank + veto + draft on AxisMatch rows that already exist. No search, no triage: ~$0.10 vs ~$1 for a full scan, which is what makes tuning the judgement affordable | `inngest/functions/radar-judge.ts` |
| `radar.person-scan` | manual (pilot) — person-outward run: marked people → their axes → queries from axes → per-axis fit → veto → one draft | `inngest/functions/tech-radar-person-scan.ts` |
| `tech-radar.run-marked` | person-first run: employers of hand-marked contacts → research → wait → scan. No manual company entry. | `inngest/functions/tech-radar-run-marked.ts` |

## Next.js version

Read `node_modules/next/dist/docs/` before writing any Next.js code.
This version has breaking changes from training data.
