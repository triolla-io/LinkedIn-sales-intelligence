# Deployment Guide

## Stack
- **Frontend + API** → Vercel (free)
- **Database** → Neon Postgres (free)
- **Background jobs** → Inngest cloud (free)
- **Rate limiting** → Upstash Redis (free)

---

## Step 1 — Neon Postgres

1. Go to [neon.tech](https://neon.tech) and create a free account
2. Create a new project → copy the **Connection string** (looks like `postgresql://user:pass@host/dbname?sslmode=require`)
3. Keep it handy for Step 4

---

## Step 2 — Upstash Redis

1. Go to [upstash.com](https://upstash.com) and create a free account
2. Create a new Redis database → copy:
   - **UPSTASH_REDIS_REST_URL**
   - **UPSTASH_REDIS_REST_TOKEN**

---

## Step 3 — Inngest Cloud

1. Go to [inngest.com](https://inngest.com) and create a free account
2. Create a new app → copy:
   - **Event Key** → `INNGEST_EVENT_KEY`
   - **Signing Key** → `INNGEST_SIGNING_KEY`

---

## Step 4 — Vercel

1. Push your code to GitHub:
   ```bash
   cd ~/linkedin-sales-intelligence
   git init
   git add -A
   git commit -m "initial commit"
   # Create a repo on github.com, then:
   git remote add origin https://github.com/YOUR_USERNAME/linkedin-sales-intelligence.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com) → New Project → import your GitHub repo

3. Under **Environment Variables**, add all of these:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | your Neon connection string |
   | `NEXTAUTH_SECRET` | run `openssl rand -base64 32` to generate |
   | `NEXTAUTH_URL` | `https://YOUR-APP.vercel.app` |
   | `GOOGLE_CLIENT_ID` | your Google client ID |
   | `GOOGLE_CLIENT_SECRET` | your Google client secret |
   | `LINKEDIN_COOKIE_ENC_KEY` | run `openssl rand -base64 32` to generate |
   | `INNGEST_EVENT_KEY` | from Inngest cloud |
   | `INNGEST_SIGNING_KEY` | from Inngest cloud |
   | `UPSTASH_REDIS_REST_URL` | from Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `APOLLO_API_KEY` | from apollo.io (for enrichment) |

4. Click **Deploy**

---

## Step 5 — Run database migrations on Neon

After deploy, run this once from your local machine with the Neon URL:

```bash
DATABASE_URL="your-neon-url" npm run db:push
```

---

## Step 6 — Connect Inngest to Vercel

1. In the Inngest dashboard → Apps → Add App
2. URL: `https://YOUR-APP.vercel.app/api/inngest`
3. Inngest will auto-discover your functions

---

## Step 7 — Update Google OAuth

In Google Cloud Console → your OAuth client → add the production redirect URI:
```
https://YOUR-APP.vercel.app/api/auth/callback/google
```

---

## Done

Your app is live. The LinkedIn sync will run as Inngest cloud jobs — no separate worker needed.
