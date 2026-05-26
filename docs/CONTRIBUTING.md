# Contributing & Local Development

## Prerequisites

- **Node.js 20+** — check with `node --version`
- **npm** (comes with Node)
- **PostgreSQL** — either [Neon](https://neon.tech) (free, cloud) or local via Docker:
  ```bash
  docker compose up -d   # starts Postgres on port 5433
  ```
- **Google account** — for OAuth sign-in during development

---

## 1. Clone & Install

```bash
git clone <repo-url>
cd linkedin-sales-intelligence
npm install
```

---

## 2. Environment Setup

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the required values:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Docker: `postgresql://linkedinsi:linkedinsi@localhost:5433/linkedinsi` · Neon: copy from dashboard |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3001` |
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create OAuth 2.0 Client |
| `GOOGLE_CLIENT_SECRET` | Same as above |
| `INNGEST_EVENT_KEY` | `local` (for local dev — Inngest dev server accepts any value) |
| `INNGEST_SIGNING_KEY` | Leave blank for local dev |
| `UPSTASH_REDIS_REST_URL` | [Upstash](https://upstash.com) free tier, or mock with a local Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Same |
| `APOLLO_API_KEY` | [apollo.io](https://app.apollo.io/#/settings/integrations/api) → API Keys |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `LINKEDIN_COOKIE_ENC_KEY` | `openssl rand -base64 32` |

**Google OAuth redirect URI** — add this to your Google OAuth client's allowed redirect URIs:
```
http://localhost:3001/api/auth/callback/google
```

---

## 3. Database Setup

```bash
npm run db:push    # applies schema to your database
```

To inspect data visually:
```bash
npm run db:studio  # opens Prisma Studio at http://localhost:5555
```

---

## 4. Run the App

```bash
npm run dev
```

This starts three processes concurrently:
- **Next.js** at `http://localhost:3001`
- **Inngest dev server** at `http://localhost:8288` (background job UI)
- **WhatsApp sidecar** at `http://localhost:3002`

Open `http://localhost:3001` and sign in with Google.

---

## 5. Seed Dev Data (recommended)

After signing in as `dev@triolla.io` at least once, run:

```bash
npm run seed:dev
```

This populates your org with:
- 4 persona users (Ariel, Daniel, Yuval, Adi) — visible in the impersonation menu
- ~30 realistic Israeli B2B contacts with varied seniority, company, and enrichment data
- 3 message templates (LinkedIn, WhatsApp, Email)
- 1 completed LinkedIn campaign
- 1 active 3-step sequence

Your `dev@triolla.io` account is upgraded to **ADMIN**, so you can impersonate any persona via the sidebar.

Re-seed at any time with:
```bash
npm run seed:dev -- --force
```

---

## 6. LinkedIn Session (for LinkedIn messaging)

LinkedIn blocks programmatic logins. Set up a persistent browser session once:

```bash
~/.local/bin/uvx --from git+https://github.com/stickerdaniel/linkedin-mcp-server linkedin-mcp-server --login
```

Chrome opens — sign in (including 2FA). Close the window when done. The session is saved to `~/.linkedin-mcp/profile/` and reused automatically. Re-run when it expires (usually every few weeks).

---

## 7. Running Tests

```bash
npm test              # unit + integration tests (vitest)
npm run test:watch    # watch mode
npm run test:e2e      # end-to-end (Playwright) — requires the app to be running
```

---

## Project Structure

```
app/
  (dashboard)/        Dashboard pages (contacts, campaigns, sequences)
  api/                API routes — all wrapped in withTenant()
  sign-in/            Auth page
components/
  dashboard/          Page-level React components
  ui/                 Shared UI primitives (shadcn)
inngest/
  client.ts           Inngest client
  functions/          One file per background job
lib/
  tenancy/            withTenant + scopedPrisma — the multi-tenant core
  apollo/             Apollo.io enrichment client
  campaigns/          Audience resolution + template rendering
  sequences/          Sequence execution logic
  classifier/         Title → seniority, company → industry
  enrichment/         AI enrichment (Gemini, Haiku)
  gmail/ hubspot/ whatsapp/ linkedin/   Channel clients
prisma/
  schema.prisma       Full data model
  migrations/         Migration history
scripts/
  seed-dev.ts         Dev data seeder (run with npm run seed:dev)
tests/
  unit/               Vitest unit tests
  integration/        Vitest integration tests
  e2e/                Playwright end-to-end tests
docs/
  CONTRIBUTING.md     This file
  superpowers/        AI assistant specs + plans
```

---

## Making Changes

### Adding an API route
1. Create `app/api/<resource>/route.ts`
2. Wrap handler with `withTenant()` from `lib/tenancy/with-tenant.ts`
3. Use `ctx.effectiveUserId` (not `ctx.user.id`) for all data queries — this handles impersonation

### Adding a background job
1. Create `inngest/functions/<name>.ts` using `inngest.createFunction()`
2. Register it in `app/api/inngest/route.ts`
3. Fire it with `inngest.send({ name: "event.name", data: { ... } })`

### Adding a service client
1. Create `lib/<service>/client.ts`
2. Export named functions — no classes

### Running one-off scripts
```bash
npx tsx scripts/<name>.ts
```
