# LinkedIn Sales Intelligence

> A multi-tenant sales intelligence platform for LinkedIn outreach. Import your connections, enrich contacts with email and phone, then run campaigns and multi-step sequences via LinkedIn, WhatsApp, or Email.

[![Node](https://img.shields.io/badge/node-20%2B-brightgreen)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-blue)](https://prisma.io)

**Live:** [sales.triolla.io](https://sales.triolla.io)

---

## Table of Contents

- [What is this?](#what-is-this)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Data Model](#data-model)
- [Key Flows](#key-flows)
- [Multi-Tenancy](#multi-tenancy)
- [Module Map](#module-map)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)

---

## What is this?

A sales intelligence platform that turns your LinkedIn connections into a structured CRM. Import a LinkedIn connections export, automatically enrich contacts with email and phone (via HubSpot, Apollo, and AI), then run targeted outreach campaigns or multi-step drip sequences — all across LinkedIn, WhatsApp, and Email from a single dashboard.

Built for small sales teams (1–10 people) at Israeli B2B companies.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  UI — Next.js App Router · React · Tailwind · shadcn/ui  │
├──────────────────────────────────────────────────────────┤
│  API Routes  (/api/*)  — all wrapped in withTenant()     │
├──────────────────────────────────────────────────────────┤
│  Background Jobs  (Inngest)                               │
│  enrich-contact · enrich-contacts-haiku                  │
│  enrich-companies · enrich-companies-web                 │
│  campaign-start · campaign-send-one · campaign-finalize  │
│  sequence-start · sequence-tick · sequence-send-execution│
├──────────────────────────────────────────────────────────┤
│  Service Clients  (lib/)                                  │
│  Apollo · HubSpot · Gmail · WhatsApp sidecar             │
│  LinkedIn Voyager · Gemini search · Claude Haiku         │
├──────────────────────────────────────────────────────────┤
│  Tenancy  — withTenant() + scopedPrisma()                │
├──────────────────────────────────────────────────────────┤
│  Database  — PostgreSQL via Prisma                       │
│  Org → User → Contact → Company                         │
│  Campaign · Sequence · Template · SentMessage            │
└──────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Database ORM | Prisma 7 |
| Database | PostgreSQL (Neon in production) |
| Background jobs | Inngest |
| Auth | NextAuth v5 (Google OAuth) |
| Rate limiting | Upstash Redis |
| Contact enrichment | HubSpot, Apollo.io |
| AI enrichment | Gemini (Hebrew names + web search) |
| Messaging | LinkedIn Voyager, WhatsApp Web (sidecar), Gmail API |
| UI | Tailwind CSS, shadcn/ui, Radix UI |
| Tests | Vitest, Playwright |

---

## Data Model

```
Organization
  └─ User (SALESPERSON / ADMIN / SUPER_ADMIN)
       ├─ Contact ──────────────────── Company
       │    └─ ContactListMember
       ├─ ContactList
       │    └─ Sequence
       │         ├─ SequenceStep
       │         └─ SequenceEnrollment
       │              └─ SequenceStepExecution ── SentMessage
       ├─ Campaign
       │    └─ CampaignRecipient ────────────── SentMessage
       ├─ MessageTemplate
       ├─ LinkedinSession
       └─ Import

Organization
  └─ PersonEnrichment  (org-scoped email/phone cache — avoids re-paying for the same contact)
  └─ EnrichmentSpend   (monthly Apollo credit counter)
```

---

## Key Flows

### 1. CSV Ingest (`POST /api/import/csv`)

1. User uploads a LinkedIn connections export (CSV or XLSX)
2. [`app/api/import/csv/route.ts`](app/api/import/csv/route.ts) parses the file, normalises LinkedIn URLs
3. [`lib/csv/diff.ts`](lib/csv/diff.ts) computes add / update / remove vs existing contacts
4. For each upserted contact:
   - Seniority + function classified by [`lib/classifier/seniority.ts`](lib/classifier/seniority.ts)
   - Industry inferred by [`lib/classifier/industry.ts`](lib/classifier/industry.ts)
   - [`PersonEnrichment`](prisma/schema.prisma) cache checked (org-scoped, free)
   - HubSpot lookup via [`lib/hubspot/client.ts`](lib/hubspot/client.ts) if no cache hit
5. Company stubs created + contacts linked by `universalName` slug
6. Inngest events fired: `contacts.enrich-haiku`, `companies.enrich-web`
7. Import history record created

### 2. Enrichment Pipeline

```
Manual enrich button (not fired on CSV import)
  └─ enrich-contact  (inngest/functions/enrich-contact.ts)
       ├─ 1. PersonEnrichment cache  — free, org-scoped
       ├─ 2. HubSpot matchPerson     — free
       └─ 3. Apollo matchPerson      — 1 credit, budget-gated per org/month
  └─ enrich-contacts-haiku  (inngest/functions/enrich-contacts-haiku.ts)
       └─ Gemini → hebrewFirstName field
  └─ enrich-companies-web  (inngest/functions/enrich-companies-web.ts)
       └─ Gemini web search → staffCount, website, description
```

Apollo credits are tracked in `EnrichmentSpend` (per org, per month). Budget set in `Organization.monthlyApolloBudget`.

### 3. Campaigns (one-shot blast)

1. Create campaign: pick channel (LINKEDIN / EMAIL / WHATSAPP) + template + optional contact filter
2. `POST /api/campaigns/:id/start` → fires `campaign.start` Inngest event
3. [`inngest/functions/campaign-start.ts`](inngest/functions/campaign-start.ts): resolves audience via [`lib/campaigns/audience.ts`](lib/campaigns/audience.ts), creates `CampaignRecipient` rows (PENDING)
4. Per recipient: renders template variables, sends via channel-specific function (`campaign-send-one` for LinkedIn, `campaign-send-whatsapp`, `campaign-send-email`)
5. `campaign.finalize`: marks campaign COMPLETED, updates stats

### 4. Sequences (multi-step drip)

1. Create a sequence on a `ContactList`, add steps: channel + template + `dayOffset` + `sendHour`
2. Start → `sequence.start` event → [`inngest/functions/sequence-start.ts`](inngest/functions/sequence-start.ts) creates `SequenceEnrollment` + `SequenceStepExecution` rows (one per contact per step), each with a `scheduledAt` timestamp
3. `sequence.tick` (triggered by cron or admin) queries for executions where `scheduledAt <= now` and fires `sequence.send-execution` for each
4. [`inngest/functions/sequence-send-execution.ts`](inngest/functions/sequence-send-execution.ts) calls [`lib/sequences/execute-send.ts`](lib/sequences/execute-send.ts), handles rate-limit retry with exponential backoff

---

## Multi-Tenancy

Every API route is wrapped with `withTenant()` ([`lib/tenancy/with-tenant.ts`](lib/tenancy/with-tenant.ts)):

- Resolves the authenticated user + their org from the JWT session
- Supports admin **impersonation** via `x-impersonation` cookie — sets `effectiveUserId` to the target user
- All data operations use `ctx.effectiveUserId` as the owner filter, never the raw session user ID

`scopedPrisma(orgUserIds)` ([`lib/tenancy/scoped-prisma.ts`](lib/tenancy/scoped-prisma.ts)) extends Prisma to automatically inject `ownerId: { in: orgUserIds }` on Contact, SentMessage, and SavedView queries. No route can accidentally return another tenant's rows.

---

## Module Map

```
lib/
  auth.ts                   NextAuth config — custom adapter auto-creates Org on first sign-in
  prisma.ts                 Singleton Prisma client
  tenancy/
    with-tenant.ts          Route middleware — auth resolution + impersonation
    scoped-prisma.ts        Prisma extension — automatic per-tenant row guard
  apollo/
    client.ts               Apollo matchPerson (email + phone enrichment)
    budget.ts               Monthly Apollo credit budget check + increment
  hubspot/client.ts         HubSpot contact lookup by LinkedIn URL
  gmail/client.ts           Gmail send via stored OAuth access token
  whatsapp/client.ts        HTTP client for the WhatsApp sidecar service
  whatsapp/phone.ts         Phone number normalisation utilities
  linkedin/sse-bus.ts       SSE event bus for LinkedIn real-time message updates
  enrichment/
    gemini-search.ts        Gemini web search for company enrichment
    gemini-names.ts         Gemini Hebrew first-name extraction
    name-lookup.ts          Name lookup utilities
    web-search.ts           Generic web search abstraction
  campaigns/
    audience.ts             Contact filter resolution for campaign recipients
    render-template.ts      {{variable}} template rendering with contact fields
    throttle.ts             Per-user send rate limiter
  sequences/
    execute-send.ts         Core send logic shared by all sequence executions
    helpers.ts              Enrollment + step query utilities
  templates/render.ts       Shared template variable renderer
  classifier/
    seniority.ts            Job title → Seniority enum (C_LEVEL/VP/DIRECTOR/…)
    industry.ts             Company name → industry string
  csv/diff.ts               diffContacts() — add/update/remove computation
  ratelimit/messages.ts     Upstash Redis rate limiter for message sends
  admin/audit.ts            AuditEvent writer
  utils/slug-utils.ts       Company name slugifier (e.g. "Google LLC" → "google-llc")
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | ✅ | JWT signing secret — `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | App base URL (e.g. `http://localhost:3001`) |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `INNGEST_EVENT_KEY` | ✅ | Inngest event signing key |
| `INNGEST_SIGNING_KEY` | ✅ | Inngest webhook signing key |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis URL (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis token |
| `APOLLO_API_KEY` | ✅ | Apollo.io enrichment API key |
| `HUBSPOT_API_KEY` | optional | HubSpot private app token |
| `GEMINI_API_KEY` | optional | Gemini for web search enrichment |
| `RESEND_API_KEY` | optional | Resend API key for team invitation emails |
| `LINKEDIN_COOKIE_ENC_KEY` | ✅ | AES key for LinkedIn session cookies — `openssl rand -base64 32` |
| `WHATSAPP_SERVICE_URL` | optional | WhatsApp sidecar URL (default: `http://localhost:3002`) |
| `LINKEDIN_PROFILE_DIR` | optional | Patchright browser profile path (default: `~/.linkedin-mcp/profile`) |

---

## Local Development

### 1. Start the database with Docker

The project ships a `docker-compose.yml` that runs Postgres, the LinkedIn MCP server, and the WhatsApp sidecar.

For local development you only **need** Postgres. Start just that service:

```bash
docker compose up postgres -d
```

This starts a Postgres 16 container and exposes it on **port 5433** (not the default 5432, to avoid conflicts with any local Postgres instance you may have).

| Setting | Value |
|---|---|
| Host | `localhost` |
| Port | `5433` |
| User | `linkedinsi` |
| Password | `linkedinsi` |
| Database | `linkedinsi` |

The corresponding `DATABASE_URL` for your `.env`:

```
DATABASE_URL="postgresql://linkedinsi:linkedinsi@localhost:5433/linkedinsi"
```

> **Note:** data is persisted in a Docker-managed volume (`postgres_data`). To wipe it: `docker compose down -v`.

### 2. Configure environment variables

Copy the example env file and fill in the required values:

```bash
cp .env.example .env
```

> **Important:** use `.env`, not `.env.local`. Scripts like `seed-dev.ts` and the Prisma CLI read from `.env` directly — `.env.local` is ignored by them.

At minimum you need:

```env
DATABASE_URL="postgresql://linkedinsi:linkedinsi@localhost:5433/linkedinsi"
NEXTAUTH_SECRET="<openssl rand -base64 32>"
NEXTAUTH_URL="http://localhost:3001"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
INNGEST_EVENT_KEY="..."
INNGEST_SIGNING_KEY="..."
LINKEDIN_COOKIE_ENC_KEY="<openssl rand -base64 32>"
```

The `DATABASE_URL` for Docker is already in `.env.example` — just uncomment the Docker line and remove the Neon placeholder.

### 3. Apply the schema and install dependencies

```bash
npm install
npm run db:push     # pushes prisma/schema.prisma to the database
```

### 4. Seed dev data (optional)

Sign in once with Google as `dev@triolla.io`, then run:

```bash
npm run seed:dev
```

This creates contacts, templates, a completed campaign, and an active sequence for that user. Run `npm run seed:dev -- --force` to re-seed.

### 5. Run the app

```bash
npm run dev
```

This starts three processes concurrently:

| Process | Port |
|---|---|
| Next.js app | 3001 |
| Inngest dev server | 8288 |
| WhatsApp sidecar | 3002 |

Open [http://localhost:3001](http://localhost:3001).

### Optional: start all Docker services

To also run the LinkedIn MCP server and WhatsApp sidecar via Docker:

```bash
docker compose up postgres linkedin-mcp whatsapp-service -d
```

| Service | Port | Purpose |
|---|---|---|
| `postgres` | 5433 | Database |
| `linkedin-mcp` | 8765 | LinkedIn MCP server (Playwright browser automation) |
| `whatsapp-service` | 3002 | WhatsApp Web sidecar |

The `linkedin-mcp` container stores its browser profile in `~/.linkedin-mcp` on the host.

---

## Troubleshooting

### `client password must be a string` / can't connect to DB

`DATABASE_URL` is missing or empty. Check:

1. You created `.env` (not `.env.local`) — run `ls -la .env`
2. The `DATABASE_URL` line is **not** commented out and uses the Docker value:
   ```
   DATABASE_URL="postgresql://linkedinsi:linkedinsi@localhost:5433/linkedinsi"
   ```
3. Postgres is actually running — `docker compose ps` should show `postgres` as `running`
4. You're connecting on port **5433**, not 5432

### `db:push` fails / Prisma can't find the database

Same root cause — `DATABASE_URL` must be set in `.env` before running any Prisma CLI command. The Prisma client in this project uses the `@prisma/adapter-pg` driver adapter, which reads `DATABASE_URL` directly from the environment at runtime (not from the schema file).

### Port 5433 already in use

Another Postgres container may be running. Stop it or change the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "5434:5432"   # use 5434 instead
```

Then update `DATABASE_URL` accordingly.

---

## Deployment

See [DEPLOY.md](DEPLOY.md) for the full Coolify deployment guide.
