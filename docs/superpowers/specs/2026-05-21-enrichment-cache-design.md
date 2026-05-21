# Enrichment Cache & Data Lifecycle — Design Spec

**Date:** 2026-05-21
**Status:** Approved

## Problem

Every contact enrichment costs Apollo credits. Currently, if two users in the same org share a mutual LinkedIn connection, both pay separately to enrich the same person. There is also no mechanism to pre-populate email/phone when a user imports a contact that a colleague already enriched. Credits are wasted; users get no benefit from org-wide enrichment history.

## Goal

Automatically reuse enrichment data across users in the org — at import time and when the user manually triggers enrichment — with zero extra actions required from the user.

**Hard rule:** Apollo is never called automatically. A call to Apollo only happens when the user explicitly clicks "Enrich". The cache is a free read-only shortcut; it never replaces the user's intent to enrich.

## Scope

Single-org system (triolla.io). No cross-org data sharing.

---

## Design

### 1. Data Model: `PersonEnrichment` Table

A new shared table, org-scoped, keyed by `linkedinUrn`:

```prisma
model PersonEnrichment {
  id               String   @id @default(cuid())
  orgId            String
  linkedinUrn      String
  email            String?
  phone            String?
  enrichedAt       DateTime
  enrichmentSource String   @default("apollo")

  org  Organization @relation(fields: [orgId], references: [id])

  @@unique([orgId, linkedinUrn])
}
```

**Role:** Single source of truth for enrichment data within an org. Every time Apollo returns data for a contact, the result is written here. Every time email/phone is needed, this table is checked first — for free.

`Contact.email` / `Contact.phone` continue to exist and are what the UI reads — they are populated from this cache when available.

---

### 2. Import Flow: Cache Lookup Before Upsert

**Current flow:**
```
CSV → Parse → Diff → Upsert Contacts
```

**New flow:**
```
CSV → Parse → Diff → PersonEnrichment batch lookup → Upsert Contacts
```

**Logic:**

1. After diff, collect all `linkedinUrn` values for `added` contacts.
2. Single batch query: `PersonEnrichment.findMany({ where: { orgId, linkedinUrn: { in: urns } } })`.
3. Build a lookup map: `urn → { email, phone, enrichedAt, enrichmentSource }`.
4. When constructing upsert data for each `added` contact:
   - Cache hit → set `email`, `phone`, `enrichedAt`, `enrichmentSource: "cached"`.
   - Cache miss → `email: null`, `phone: null`. No Apollo call. User enriches manually later.
5. For `updated` contacts (existing contacts with changed LinkedIn data): never overwrite `email`/`phone` — only update LinkedIn fields (title, company, etc.).

**Result:** A user who imports 100 contacts and 40 of them were already enriched by a colleague gets those 40 with email/phone immediately. The remaining 60 stay blank until the user manually triggers enrichment.

---

### 3. Enrich-Contact: Cache Lookup Before Apollo

**Modified flow in `enrich-contact.ts`:**

```
enrich.contact event  ← only fires when user clicks "Enrich"
  → budget check (existing)
  → PersonEnrichment lookup by (orgId, linkedinUrn)
      → HIT  → copy email/phone to Contact, set enrichmentSource: "cached"
               skip Apollo call, skip credit charge
      → MISS → call matchPerson() → save to Contact
               upsert into PersonEnrichment
               charge credit
```

**Details:**

- Lookup: `prisma.personEnrichment.findUnique({ where: { orgId_linkedinUrn: { orgId, linkedinUrn } } })`
- Cache hit: update Contact with email/phone, mark `enrichmentSource: "cached"`, do NOT increment `EnrichmentSpend`.
- Cache miss: existing Apollo flow unchanged, then `upsert` into `PersonEnrichment` so future lookups are free.
- Budget check stays at the top — a cache hit short-circuits before any budget is consumed.

---

### 4. UX: Import vs Update

No pipeline change — the existing diff logic already handles both cases correctly (unchanged contacts are skipped, only added/updated/removed are processed).

**UI changes only:**

- If the user already has contacts: show "עדכן רשימה" as a prominent option alongside "ייבוא ראשון".
- Import summary screen shows a richer breakdown: "X חדשים, Y עודכנו, Z הוסרו, W קיבלו email מה-cache".
- No new backend routes or parameters needed.

---

## Data Flow Summary

```
User A enriches contact (linkedinUrn: X) — manual click
  → Apollo called → email saved on Contact A
  → PersonEnrichment upserted { orgId, linkedinUrn: X, email }

User B imports CSV containing linkedinUrn: X
  → Cache lookup finds X → email pre-populated on Contact B
  → No Apollo call, no credit charged

User B imports linkedinUrn: Y (not in cache)
  → Cache miss → Contact B created with email: null
  → User B clicks "Enrich" on that contact
  → Cache miss again → Apollo called → credit charged
  → PersonEnrichment upserted for Y → future imports/enrichments free
```

---

## Files to Change

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `PersonEnrichment` model |
| `app/api/import/csv/route.ts` | Batch cache lookup after diff, before upsert |
| `inngest/functions/enrich-contact.ts` | Cache lookup before Apollo; upsert to cache after Apollo |
| `prisma/migrations/` | New migration for `PersonEnrichment` table |

No changes to: API routes for enrichment triggers, Contact schema, budget logic, UI enrichment buttons.

---

## Out of Scope

- Automatic Apollo calls (enrichment is always user-initiated)
- Cross-org data sharing
- TTL / expiry on `PersonEnrichment` records
- Background refresh of stale data (user re-uploads CSV manually to update their list)
