# Company Signals Routine — Design

**Date:** 2026-07-20
**Status:** Approved (brainstorming) → pending implementation plan
**Author:** Ariel + Claude

## Goal

For every company in the system, automatically detect fresh, positive news
signals (funding rounds, hiring/headcount growth, office moves, product/tool
launches, awards, milestones, new executive hires) and **prepare** a personal
congratulatory LinkedIn message ("מזל טוב" / "כל הכבוד") for the relevant
C-level contact. Messages are **drafted, never auto-sent** — they wait for the
customer to review, edit, and approve. The aim is to generate stronger, fresher
leads off timely, celebratory outreach.

This mirrors the existing **job-change routine** one level up: instead of
"person changed job → draft congrats", it is "company had a positive event →
draft congrats to our C-level contact there".

## Non-goals

- No automatic sending. Ever. Drafts are prepared and reviewed by a human.
- No negative news (layoffs, lawsuits, revenue drops) — positive events only.
- v1 does not integrate a dedicated client per publication (Crunchbase, X API,
  Calcalist/Globes RSS). Those can be added later on top of the same layer.

## Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Data sources (v1) | Three **free-tier, live** search/news providers, cross-referenced: **Tavily** (primary; ~1k searches/mo free), **Serper** (~2.5k free credits), **GNews** (100 req/day free). Each returns fresh source URLs from multiple publications. Apollo/Crunchbase/X/OpenRouter-online are **not** in the v1 critical path — Apollo kept only as optional funding confirmation, the rest deferred. |
| Message target | **C-level contacts** at the company (per owner who owns that contact). |
| Monitoring scope | Only companies that have ≥1 C-level contact owned by a user with the module enabled. |
| Reliability bar | An event becomes **verified** only if corroborated by **2+ independent sources** — counted as **2+ distinct publication domains** across the combined Tavily + Serper + GNews results — OR from a single **official** source (the company's own domain). Only verified events produce drafts. |
| Transparency | Every draft shows a confidence score + clickable source links regardless. |
| Cadence | Weekly per company (`0 4 * * 0`), with a daily company cap and dedup. Tunable. |

## Architecture

Reuses the proven job-change pipeline shape:

```
weekly cron tick
  → per company: fetch Tavily + Serper + GNews  [parallel]
  → detectCompanySignals(): LLM extract + classify + cross-reference + dedupe
  → verified new event → draft per (owner, C-level contact)
  → CompanySignalDraft (PENDING_REVIEW)
  → customer reviews / edits in /routine/company-signals
  → approve → ExtensionTask (kind SEND)  ← existing send path, unchanged
  → extension sends → extension-task-result flips to SENT
```

### Data model (Prisma)

Two new models, mirroring the shared-`Company` / owner-scoped-`ContactJobChange`
split.

**`CompanySignal`** — the event, company-level, shared across tenants:

```prisma
model CompanySignal {
  id          String              @id @default(cuid())
  companyId   String
  company     Company             @relation(fields: [companyId], references: [id])
  signalType  CompanySignalType
  title       String              // e.g. "גייסה 12M$ סבב A"
  summary     String              @db.Text
  eventDate   DateTime?           // when the event actually happened
  confidence  Float               // 0-1
  sources     Json                // [{ name, url, publishedAt }]
  verified    Boolean             @default(false) // passed the 2-source bar
  dedupeKey   String              // companyId + signalType + topic/month
  status      CompanySignalStatus @default(DETECTED)
  detectedAt  DateTime            @default(now())
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  drafts      CompanySignalDraft[]
  @@unique([companyId, dedupeKey])
  @@index([status])
}

enum CompanySignalType {
  FUNDING
  HIRING_GROWTH
  OFFICE_MOVE
  PRODUCT_LAUNCH
  AWARD
  MILESTONE
  EXEC_HIRE
}

enum CompanySignalStatus {
  DETECTED   // found, not yet verified
  VERIFIED   // passed 2-source bar, eligible for drafting
  DRAFTED    // at least one draft created
  ARCHIVED
}
```

**`CompanySignalDraft`** — the drafted message, owner-scoped, mirrors
`ContactJobChange`:

```prisma
model CompanySignalDraft {
  id            String                   @id @default(cuid())
  signalId      String
  signal        CompanySignal            @relation(fields: [signalId], references: [id])
  ownerId       String
  owner         User                     @relation(fields: [ownerId], references: [id])
  contactId     String
  contact       Contact                  @relation(fields: [contactId], references: [id])
  draftMessage  String                   @db.Text
  status        CompanySignalDraftStatus @default(PENDING_REVIEW)
  channel       String                   @default("LINKEDIN")
  sentAt        DateTime?
  createdAt     DateTime                 @default(now())
  updatedAt     DateTime                 @updatedAt
  @@unique([signalId, contactId]) // one draft per event × contact
  @@index([ownerId, status])
}

enum CompanySignalDraftStatus {
  PENDING_REVIEW
  APPROVED
  SENT
  DISMISSED
}
```

Also add to `Company`: `lastSignalCheckAt DateTime?` (drives the tick selection).
Add `companySignals CompanySignal[]` relation to `Company`, and the
`companySignalDrafts` back-relations to `User` and `Contact`.

**Dedup:** `dedupeKey` (e.g. `funding-2026-07` or a normalized topic slug)
guarantees we never re-draft an event already handled, even if a source reports
it again days later.

### Inngest pipeline

Four new functions (registered in `app/api/inngest/route.ts`; added to the
CLAUDE.md event index). Follows the job-change pattern precisely.

1. **`inngest/functions/company-signals-tick.ts`** — cron `0 4 * * 0`.
   Selects companies with ≥1 C-level contact owned by a module-enabled user,
   `lastSignalCheckAt` null or > 7 days ago. Groups, respects a daily company
   cap (like `DAILY_CAP` in `brightdata-job-check-tick.ts`), emits
   `company.signals.detect` per company.

2. **`inngest/functions/company-signals-detect.ts`** — event
   `company.signals.detect`, per company:
   - Fetch Tavily + Serper + GNews in parallel (`lib/news/*`), each degrading
     gracefully to `[]` if its key is absent or it errors.
   - `detectCompanySignals()` (core in `lib/company-signals/detect.ts`) — LLM
     extracts candidate events from the merged raw results, classifies to
     `CompanySignalType`, cross-references sources (distinct-domain count),
     sets `verified`, computes `dedupeKey`, `confidence`.
   - Upsert `CompanySignal` (skip existing `dedupeKey`). For each **verified,
     new** event → emit `company.signals.draft`.
   - Update `Company.lastSignalCheckAt`.

3. **`inngest/functions/company-signals-draft.ts`** — event
   `company.signals.draft`, per verified event:
   - Find all C-level contacts (owned by module-enabled users) at the company.
   - For each `(owner, contact)`: LLM drafts a short personal Hebrew congrats
     (`lib/company-signals/draft.ts`, parallel to `judge-change.ts`).
   - Create `CompanySignalDraft` `PENDING_REVIEW`; upsert the contact into a
     per-owner "איתותי חברה" `ContactList` (same as job-changes does).
   - Set `CompanySignal.status = DRAFTED`.

4. **Sending** — *not a new function*. Reuses the existing path: UI approve →
   `ExtensionTask` (kind `SEND`, carrying `companySignalDraftId`) → extension
   sends → `inngest/functions/extension-task-result.ts` flips the draft to
   `SENT` + `sentAt`. (Requires teaching `extension-task-result` to resolve a
   `companySignalDraftId` alongside the existing `jobChangeId`.)

New Inngest events: `company.signals.detect`, `company.signals.draft`, plus the
weekly cron.

### News source clients (`lib/news/`)

Three thin adapters, each wrapping one free-tier live search/news API and
returning a normalized `NewsResult[]` (`{ title, url, snippet, source, publishedAt }`):

| Client | File | Wraps | Env var | Free tier |
|---|---|---|---|---|
| Tavily | `lib/news/tavily.ts` | Tavily Search API | `TAVILY_API_KEY` | ~1,000 searches/mo |
| Serper | `lib/news/serper.ts` | Serper.dev (Google news/search) | `SERPER_API_KEY` | ~2,500 credits |
| GNews | `lib/news/gnews.ts` | GNews API | `GNEWS_API_KEY` | 100 req/day |

Each client degrades gracefully — missing key or error returns `[]` (never
throws), consistent with the existing client convention. A shared
`fetchCompanyNews(company)` fans out to all three in parallel and merges the
results, tagging each with its provider and publication domain.

### LLM calls (via OpenRouter, raw fetch, existing convention)

**Extraction** (`lib/company-signals/detect.ts`) — input: merged
Tavily + Serper + GNews results. Strict-JSON output (schema retry, like
`openrouter-search.ts`):

```
{ events: [{ signalType, title, summary, eventDate, sources: [{name,url,publishedAt}], distinctDomainCount }] }
```

Prompt rules: identify **only** positive, congratulation-worthy events; ignore
negative news; attach the source URL(s) each event came from; never invent — an
event with no URL is dropped. `verified = distinctDomainCount >= 2 || official
source (company's own domain)`. `confidence` derived from the number and type of
distinct sources.

**Drafting** (`lib/company-signals/draft.ts`) — input: event + contact
name/title + company name. Output: short, personal Hebrew LinkedIn message.
Requires `OPENROUTER_API_KEY` — **throws if missing, never guesses** (consistent
with `judge-change.ts`). Model via new env `COMPANY_SIGNALS_MODEL` (default
`anthropic/claude-haiku-4.5`).

### UI — Routine module

New module `/routine/company-signals` ("איתותי חברות"), third item in the
Routine sidebar group (`components/dashboard/sidebar.tsx`), beside "בקשות חברות"
and "עדכוני תפקיד".

- **Per-org toggle** — `Organization.companySignalsEnabled` (default false), added
  to `lib/routine/modules.ts` as key `companySignals` (extend
  `RoutineModuleKey`), consistent with `jobChecks`.
- **Review page** (HeroUI, parallel to job-changes page): lists
  `CompanySignalDraft` `PENDING_REVIEW`, grouped by company/event. Each card
  shows company name + event-type badge + title, **confidence score + source
  links** (transparency), the C-level contact, and the draft text in an
  **editable** field. Buttons: **אישור ושליחה** (→ ExtensionTask SEND), **ערוך**,
  **דחה** (DISMISSED).
- **API** `app/api/company-signals/[id]/route.ts` — guarded status transitions
  (PENDING_REVIEW→APPROVED one-way, like `app/api/job-changes/[id]/route.ts`),
  wrapped in `withTenant()`, filtered by `ctx.effectiveUserId`.

## Data flow summary

```
cron → detect → verify(2 sources) → draft PENDING_REVIEW
     → customer reviews/edits → approve → ExtensionTask SEND
     → extension sends → SENT
```

No message is ever sent automatically — it is only prepared for the customer.

## Error handling

- Missing `OPENROUTER_API_KEY` → drafting throws (forces Inngest retry), never
  guesses. Same rule as `judge-change.ts`.
- Any news client (Tavily/Serper/GNews) missing its key or erroring → returns
  `[]`; detection still runs on whatever the other providers returned (graceful
  degradation). If all three return nothing, advance `lastSignalCheckAt` and exit
  quietly.
- Event with no source URL → dropped by the extraction prompt (no phantom
  signals).
- Duplicate event (existing `dedupeKey`) → skipped, no new draft.
- `withTenant()` on all routes; never raw `prisma` for tenant-scoped reads of
  `CompanySignalDraft`/`Contact` — always filter by `ctx.effectiveUserId`.

## Testing

- Unit `lib/news/*`: each adapter normalizes results; missing key / error → `[]`.
- Unit `lib/company-signals/detect.ts`: cross-referencing (2 distinct domains →
  verified; single domain → not verified), dedup (existing key → skip),
  negative-news filtering, no-URL drop.
- Unit `lib/company-signals/draft.ts`: throws when `OPENROUTER_API_KEY` absent;
  produces Hebrew text on happy path (mock OpenRouter).
- Integration: status transitions in `app/api/company-signals/[id]/route.ts`
  under `withTenant` (PENDING_REVIEW→APPROVED one-way; cross-tenant access
  denied).

## Cost & cadence controls

- All three v1 sources are **free-tier** — expected to stay within free limits.
  Est. ~300 companies × weekly ≈ 1,300 searches/mo, split across Tavily (~1k free)
  + GNews (100/day free) + Serper credits.
- Weekly per-company check (funding/product news is infrequent).
- Daily company cap in the tick (bounds source-API calls/day; keeps GNews under
  its 100/day limit).
- `dedupeKey` prevents repeated drafting of the same event.
- Scope limited to companies with a module-enabled C-level contact.
- Tunable to a 3-day cadence later without architectural change.

## Future extensions (not v1)

- Add X (Twitter), Crunchbase, and OpenRouter-online as additional source
  adapters feeding the same cross-reference layer (each is a paid tier).
- Apollo `organizations/enrich` as optional structured confirmation for funding
  events (kept out of the v1 critical path because it lags on freshness).
- WhatsApp / email channels for the drafted congrats (schema `channel` field
  already anticipates this).
