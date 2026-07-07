# Staging setup runbook — remaining steps

Status as of 2026-07-07: all staging **code** is merged to `main` (anonymizer, banner,
extension permissions, refresh script). The staging **Postgres** exists in Coolify
(container `qdu8dzxr7ujoe9v7ui5rbkhx`, db `linkedinsi_staging`) but is empty.
What's missing is everything below — external keys, the Coolify app, DNS, first
deploy, and the nightly refresh. Full design: `docs/superpowers/plans/2026-06-23-staging-environment.md`.

> Prerequisite: the Dockerfile change that ships `scripts/`, `lib/`, and
> `tsconfig.json` into the runtime image must be merged and built — the
> anonymizer and the `post_deployment_command` run inside the app container.

## 1. Inngest — staging environment (dashboard)

Create a staging environment in Inngest Cloud (app id stays
`linkedin-sales-intelligence`). Copy its **Event Key** and **Signing Key** →
env vars in step 5. After the first deploy, verify functions registered under
the **staging** environment, not prod.

## 2. Upstash — staging Redis (dashboard)

Create a separate Redis database. Copy REST URL + token → step 5.
Do NOT reuse prod's Redis — locks/rate-limits must not collide.

## 3. Google OAuth (Google Cloud Console)

On the existing OAuth client (same client id/secret as prod), add:
- Authorized redirect URI: `https://staging.triolla.io/api/auth/callback/google`
- Authorized JavaScript origin: `https://staging.triolla.io`

## 4. Coolify — create the staging app (dashboard `http://178.105.107.141:8000`)

In project **triolla-dev**: New Resource → Application →
repo `triolla-io/LinkedIn-sales-intelligence`, branch `main`, build pack
**Dockerfile**, port `3000`. Name: `linkedin-sales-intelligence-staging`.
- FQDN: `https://staging.triolla.io`
- `post_deployment_command`:
  `npx tsx scripts/backfill-missing-step-executions.ts && curl -s -X PUT https://staging.triolla.io/api/inngest`
- Enable **auto-deploy on push to `main`** (prod stays manual — don't touch prod).
- Do NOT deploy yet — env vars first.

## 5. Env vars for the staging app

**Different from prod:**

| Key | Value |
|---|---|
| `DATABASE_URL` | staging DB **internal** URL — host `qdu8dzxr7ujoe9v7ui5rbkhx`, db `linkedinsi_staging` (creds: Coolify → the staging DB resource) |
| `NEXTAUTH_URL` | `https://staging.triolla.io` |
| `NEXTAUTH_SECRET` | fresh: `openssl rand -base64 32` |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | from step 1 (staging env) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | from step 2 |
| `APP_ENV` | `staging` (drives the STAGING banner) |
| `STAGING_TEST_PHONE` | your E.164 test number, e.g. `+9725…` |
| `STAGING_TEST_LINKEDIN_URLS` | comma-separated pool of your controlled test LinkedIn profile URLs |
| `WHATSAPP_SERVICE_URL` | v1: reuse prod's whatsapp-service URL — recipients are already rerouted to `STAGING_TEST_PHONE` |

**Copy from prod as-is:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`APOLLO_API_KEY`, `APOLLO_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `ADMIN_SECRET`,
`NODE_ENV=production`, and if set on prod: `MCP_OWNER_EMAIL`, `UVX_PATH`.

**⚠️ Deliberately consider NOT setting on staging:**
- `HUBSPOT_API_KEY` — the daily `hubspot-sync-apollo` cron would push staging's
  anonymized data into the **real** HubSpot portal. Leave unset (or point at a
  sandbox portal) unless that's intended.
- `BRIGHTDATA_API_KEY` — the daily Bright Data job-check cron consumes paid
  snapshots; running it from both envs doubles cost. Leave unset unless needed.

## 6. Cloudflare DNS

Add a record for `staging` on `triolla.io` identical to `sales`
(same type/target/proxy setting → `178.105.107.141`).

## 7. First deploy + verify

Deploy in Coolify, watch build + boot logs, then:
1. Boot log shows `prisma migrate deploy` succeeded (no P3009) — this fills the
   empty staging DB with the full schema.
2. `curl -s -o /dev/null -w "%{http_code}" https://staging.triolla.io` → `200`/`307`, not `502`.
3. STAGING banner visible on the login page; Google login works.
4. Inngest dashboard: functions registered under the **staging** environment.

## 8. First refresh (prod → staging, anonymized)

On your machine, from the repo root:

```bash
STAGING_APP=$(ssh root@178.105.107.141 'docker ps --format "{{.Names}}" | grep -m1 "^<staging-app-uuid>"')
STAGING_USER=$(ssh root@178.105.107.141 'grep -oE "POSTGRES_USER=[^ ]+" /data/coolify/databases/qdu8dzxr7ujoe9v7ui5rbkhx/docker-compose.yml | cut -d= -f2')
ssh root@178.105.107.141 "STAGING_DB_CONTAINER=qdu8dzxr7ujoe9v7ui5rbkhx STAGING_DB_USER=$STAGING_USER STAGING_DB_NAME=linkedinsi_staging STAGING_APP_CONTAINER=$STAGING_APP bash -s" < scripts/staging/refresh-from-prod.sh
```

Expected: ends with `✅ staging refreshed from prod (anonymized, verified)`.
The script fails closed: it refuses non-"staging" DB names, checks Postgres
version compatibility, and aborts if any contact email was left un-rerouted.

## 9. Nightly refresh schedule

Coolify → staging app → Scheduled Tasks (or server cron), daily at **04:00**
(after prod's 02:00/03:00 crons), running the same command as step 8's inner
`bash` line. Next morning, re-run the step-8 leak check.

## 10. End-to-end fidelity test

Per `docs/staging-pre-deploy-checklist.md`: login → extension pointed at
`https://staging.triolla.io` → one send per channel (LinkedIn / email /
WhatsApp) arrives at your test targets only.
