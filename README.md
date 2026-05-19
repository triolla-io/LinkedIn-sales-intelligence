This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## LinkedIn Session Setup (one-time)

LinkedIn blocks programmatic logins, so the sync uses a real browser
session that you authenticate once:

```bash
~/.local/bin/uvx --from git+https://github.com/stickerdaniel/linkedin-mcp-server linkedin-mcp-server --login
```

Chrome opens, you sign in (including 2FA/captcha if prompted), then close
the window. The session is saved to `~/.linkedin-mcp/profile/` and reused
by every subsequent sync. Re-run this command when the session expires
(usually after several weeks).

## Company Enrichment

After every connection sync, the app enriches contacts with company data via LinkedIn's Voyager API — no Apollo credits required.

### How it works

1. **Sync** (`sync.full` or `sync.delta` event) — the existing DOM scraper fetches connections and upserts contacts. Each contact's `currentCompany` string (e.g. `"Microsoft"`) is slugified and stored as a stub `Company` row (`universalName = "microsoft"`).

2. **Enrich** (`companies.enrich` event) — the `enrich-companies` Inngest function calls `lib/linkedin/voyager_companies.py`, which hits:
   ```
   GET /voyager/api/organization/companies?q=universalName&universalName={slug}
   ```
   This returns `staffCount` (exact integer) and `industries` (e.g. `["Software Development"]`).

3. **Filter** — contacts can now be filtered by:
   - `staffCount BETWEEN 30 AND 500`
   - `industry = "Fintech"` (or any industry string)

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `LINKEDIN_PROFILE_DIR` | `~/.linkedin-mcp/profile` | Path to the Patchright browser profile used to extract `li_at` + `JSESSIONID` cookies |

### Session management

The company scraper opens a Patchright browser with the linkedin-mcp persistent profile to extract cookies. If the session has expired, the scraper exits with `SESSION_EXPIRED` and the Inngest function fails (retries 2×). Re-run `linkedin-mcp-server --login` to restore the session.

### Slug matching

Company names are slugified before lookup: `"Google LLC"` → `"google-llc"`. If LinkedIn's `universalName` differs (e.g., `"google"` not `"google-llc"`), the API returns an empty response and the Company row stays with `staffCount: null`. This is expected for edge cases — partial enrichment is acceptable.
