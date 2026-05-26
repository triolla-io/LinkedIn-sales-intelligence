# Deployment Guide

Production URL: **https://sales.triolla.io**

## Stack

| Service | Provider |
|---|---|
| Frontend + API | Coolify (self-hosted) |
| Database | Neon Postgres |
| Background jobs | Inngest Cloud |
| Rate limiting | Upstash Redis |
| WhatsApp | Separate Coolify service |

---

## Step 1 — Neon Postgres

1. Go to [neon.tech](https://neon.tech) → create a free project
2. Copy the **Connection string**: `postgresql://user:pass@host/dbname?sslmode=require`

---

## Step 2 — Upstash Redis

1. Go to [upstash.com](https://upstash.com) → create a Redis database
2. Copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

## Step 3 — Inngest Cloud

1. Go to [inngest.com](https://inngest.com) → create an app
2. Copy:
   - **Event Key** → `INNGEST_EVENT_KEY`
   - **Signing Key** → `INNGEST_SIGNING_KEY`

---

## Step 4 — Coolify App

1. In your Coolify instance → **New Resource** → **Application**
2. Connect your GitHub repo
3. Set:
   - **Build command:** `npm run build`
   - **Start command:** `npm start`
   - **Port:** `3000`
4. Add all environment variables (see table below)
5. Deploy

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://sales.triolla.io` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `INNGEST_EVENT_KEY` | From Inngest cloud |
| `INNGEST_SIGNING_KEY` | From Inngest cloud |
| `UPSTASH_REDIS_REST_URL` | From Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | From Upstash |
| `APOLLO_API_KEY` | From apollo.io |
| `HUBSPOT_API_KEY` | HubSpot private app token |
| `ANTHROPIC_API_KEY` | For Haiku Hebrew name enrichment |
| `GEMINI_API_KEY` | For web search enrichment |
| `LINKEDIN_COOKIE_ENC_KEY` | `openssl rand -base64 32` |
| `WHATSAPP_SERVICE_URL` | URL of your WhatsApp Coolify service |

---

## Step 5 — Run Database Migrations

After the first deploy, run once from your local machine:

```bash
DATABASE_URL="your-neon-url" npm run db:push
```

---

## Step 6 — Connect Inngest to your App

1. Inngest Dashboard → **Apps** → **Add App**
2. URL: `https://sales.triolla.io/api/inngest`
3. Inngest auto-discovers all functions

---

## Step 7 — Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → your OAuth client → add:

```
https://sales.triolla.io/api/auth/callback/google
```

---

## Step 8 — WhatsApp Sidecar

Deploy the `whatsapp-service/` directory as a separate Coolify application:
- **Build:** `npm install`
- **Start:** `npm start`
- Set `WHATSAPP_SERVICE_URL` in the main app to point to this service

---

## Step 9 — LinkedIn Session (one-time per server)

SSH into the production server and run:

```bash
~/.local/bin/uvx --from git+https://github.com/stickerdaniel/linkedin-mcp-server linkedin-mcp-server --login
```

Re-run when the session expires (typically every few weeks).
