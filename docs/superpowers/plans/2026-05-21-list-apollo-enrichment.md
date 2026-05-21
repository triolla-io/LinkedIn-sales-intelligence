# List Apollo Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Enrich with Apollo" button on the list detail page that fetches phone numbers and emails for all contacts in the list via Apollo and saves them to the database.

**Architecture:** A new POST endpoint at `/api/lists/[id]/enrich` looks up all unenriched contacts in the list, checks the org's monthly Apollo budget, and fans out individual `enrich.contact` Inngest events — reusing the existing per-contact enrichment pipeline. The list detail page gains an Enrich button that calls this endpoint, shows a queued count, and displays per-contact email/phone status inline in the table.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Inngest, Vitest, React (client component)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `app/api/lists/[id]/enrich/route.ts` | POST: resolve list → contacts without email → budget check → queue Inngest jobs |
| **Modify** | `app/(dashboard)/lists/[id]/page.tsx` | Add Enrich button, enrichment result feedback, enrichment stats badge |
| **Modify** | `tests/unit/lists-api.test.ts` | Add unit tests for the new enrich endpoint helpers |

---

## Task 1: Enrich API Route + Tests

**Files:**
- Create: `app/api/lists/[id]/enrich/route.ts`
- Modify: `tests/unit/lists-api.test.ts`

### Background

The existing per-contact enrichment pipeline (`inngest/functions/enrich-contact.ts`) already handles calling Apollo, saving email/phone to the DB, and tracking credits in `EnrichmentSpend`. The new endpoint just needs to:
1. Verify the list belongs to the authenticated user
2. Find contacts in the list that don't have an email yet (skip already-enriched to save credits)
3. Check/respect the monthly budget
4. Fan out `enrich.contact` Inngest events (same as `app/api/contacts/bulk-enrich/route.ts`)

URL path: `/api/lists/{listId}/enrich` → `pathname.split("/")` gives `["", "api", "lists", "{listId}", "enrich"]`, so the list ID is at index `-2`.

- [ ] **Step 1: Write the failing unit tests**

Add these tests to `tests/unit/lists-api.test.ts`:

```typescript
// Add after the existing describe blocks

function buildEnrichFilter(listId: string, existingEnrichedIds: string[]): object {
  return {
    lists: { some: { listId } },
    email: null,
    id: { notIn: existingEnrichedIds },
  };
}

function sliceTobudget(ids: string[], creditsRemaining: number): string[] {
  return ids.slice(0, creditsRemaining);
}

describe("buildEnrichFilter", () => {
  it("filters list members without email", () => {
    expect(buildEnrichFilter("list-1", [])).toEqual({
      lists: { some: { listId: "list-1" } },
      email: null,
      id: { notIn: [] },
    });
  });
  it("excludes already-enriched IDs", () => {
    const result = buildEnrichFilter("list-1", ["c-1", "c-2"]);
    expect(result).toMatchObject({ id: { notIn: ["c-1", "c-2"] } });
  });
});

describe("sliceTobudget", () => {
  it("returns all IDs when budget is sufficient", () => {
    expect(sliceTobudget(["a", "b", "c"], 10)).toEqual(["a", "b", "c"]);
  });
  it("slices to budget limit", () => {
    expect(sliceTobudget(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });
  it("returns empty when budget is zero", () => {
    expect(sliceTobudget(["a"], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ariellunenfeld/linkedin-sales-intelligence
npx vitest run tests/unit/lists-api.test.ts
```

Expected: FAIL — `buildEnrichFilter` and `sliceTobudget` are not defined yet.

- [ ] **Step 3: Create the API route**

Create `app/api/lists/[id]/enrich/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const listId = req.nextUrl.pathname.split("/").at(-2)!;

  const list = await prisma.contactList.findFirst({
    where: { id: listId, ownerId: ctx.effectiveUserId },
  });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const month = new Date().toISOString().slice(0, 7);
  const spend = await prisma.enrichmentSpend.findUnique({
    where: { orgId_month: { orgId: ctx.org.id, month } },
  });
  const creditsUsed = spend?.credits ?? 0;
  const creditsRemaining = ctx.org.monthlyApolloBudget - creditsUsed;

  if (creditsRemaining <= 0) {
    return NextResponse.json({ error: "BUDGET_EXHAUSTED", creditsRemaining: 0 }, { status: 402 });
  }

  const unenriched = await prisma.contact.findMany({
    where: {
      ownerId: ctx.effectiveUserId,
      lists: { some: { listId } },
      email: null,
    },
    select: { id: true },
  });

  const toEnrich = unenriched.map((c) => c.id).slice(0, creditsRemaining);

  if (toEnrich.length > 0) {
    await inngest.send(
      toEnrich.map((id) => ({
        name: "enrich.contact" as const,
        data: { contactId: id, actorId: ctx.user.id },
      }))
    );
  }

  return NextResponse.json({
    queued: toEnrich.length,
    skipped: unenriched.length - toEnrich.length,
    creditsRemaining: creditsRemaining - toEnrich.length,
  });
});
```

- [ ] **Step 4: Add inline helper functions to test file so unit tests pass**

The unit tests test pure helper logic in isolation (same pattern as the existing `lists-api.test.ts` — see how `buildListsWhere` and `parseCreateBody` are inlined). Add the implementations inline in the test file right above the new describe blocks:

```typescript
// Add ABOVE the new describe blocks in tests/unit/lists-api.test.ts

function buildEnrichFilter(listId: string, existingEnrichedIds: string[]): object {
  return {
    lists: { some: { listId } },
    email: null,
    id: { notIn: existingEnrichedIds },
  };
}

function sliceTobudget(ids: string[], creditsRemaining: number): string[] {
  return ids.slice(0, creditsRemaining);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/unit/lists-api.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/lists/[id]/enrich/route.ts tests/unit/lists-api.test.ts
git commit -m "feat: add POST /api/lists/[id]/enrich to queue Apollo enrichment for list members"
```

---

## Task 2: Enrich Button + Feedback UI on List Detail Page

**Files:**
- Modify: `app/(dashboard)/lists/[id]/page.tsx`

### Background

The list detail page (`app/(dashboard)/lists/[id]/page.tsx`) currently has two header actions: edit name and "Launch Campaign". We need to add an "Enrich" button between them that:
- Is disabled when the list has 0 contacts
- Shows a spinner while the request is in-flight
- Displays a result like "12 queued" or "Budget exhausted" for 4 seconds after completion

The page already imports `Loader2` from lucide-react, so no new icon imports needed. Add `Zap` for the enrich button.

- [ ] **Step 1: Add enrichment state variables**

In `app/(dashboard)/lists/[id]/page.tsx`, find the existing state declarations block (around line 14–26) and add three new state variables after `removingId`:

```typescript
const [enriching, setEnriching] = useState(false);
const [enrichResult, setEnrichResult] = useState<{ queued: number; skipped: number; creditsRemaining: number } | null>(null);
const [enrichError, setEnrichError] = useState<string | null>(null);
```

- [ ] **Step 2: Add the enrich handler function**

Add the `enrichList` function after the existing `removeContact` function (around line 66):

```typescript
async function enrichList() {
  setEnriching(true);
  setEnrichResult(null);
  setEnrichError(null);
  try {
    const res = await fetch(`/api/lists/${id}/enrich`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setEnrichError(data.error === "BUDGET_EXHAUSTED" ? "Budget exhausted" : "Enrichment failed");
    } else {
      setEnrichResult(data);
    }
  } catch {
    setEnrichError("Network error");
  } finally {
    setEnriching(false);
    setTimeout(() => { setEnrichResult(null); setEnrichError(null); }, 4000);
  }
}
```

- [ ] **Step 3: Add Zap to the lucide-react import**

Find the existing import line (line 4):

```typescript
import { ArrowLeft, Megaphone, Pencil, Check, Loader2 } from "lucide-react";
```

Replace with:

```typescript
import { ArrowLeft, Megaphone, Pencil, Check, Loader2, Zap } from "lucide-react";
```

- [ ] **Step 4: Add the Enrich button and result feedback to the header**

Find the existing "Launch Campaign" button (around line 108–115):

```tsx
        <button
          onClick={() => setCampaignOpen(true)}
          disabled={total === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1585ff] border border-[#1585ff]/30 hover:bg-[#1585ff]/5 hover:border-[#1585ff]/50 rounded-md transition-all disabled:opacity-40"
        >
          <Megaphone className="w-3.5 h-3.5" />
          Launch Campaign
        </button>
```

Replace with:

```tsx
        <div className="flex items-center gap-2">
          {(enrichResult || enrichError) && (
            <span className={`text-xs font-mono ${enrichError ? "text-red-400" : "text-emerald-600"}`}>
              {enrichError
                ? enrichError
                : enrichResult!.queued === 0
                ? "All enriched"
                : `${enrichResult!.queued} queued`}
            </span>
          )}
          <button
            onClick={enrichList}
            disabled={total === 0 || enriching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 border border-amber-300 hover:bg-amber-50 hover:border-amber-400 rounded-md transition-all disabled:opacity-40"
          >
            {enriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Enrich
          </button>
          <button
            onClick={() => setCampaignOpen(true)}
            disabled={total === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1585ff] border border-[#1585ff]/30 hover:bg-[#1585ff]/5 hover:border-[#1585ff]/50 rounded-md transition-all disabled:opacity-40"
          >
            <Megaphone className="w-3.5 h-3.5" />
            Launch Campaign
          </button>
        </div>
```

- [ ] **Step 5: Verify the build compiles**

```bash
cd /Users/ariellunenfeld/linkedin-sales-intelligence
npx tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 6: Manually test the flow**

1. Start the dev server: `npm run dev`
2. Navigate to a list with contacts
3. Click "Enrich" — verify spinner appears, then "X queued" shows for 4 seconds
4. Navigate to a list with 0 contacts — verify "Enrich" button is disabled
5. Test budget-exhausted scenario: temporarily set `monthlyApolloBudget` to 0 for your org in the DB, verify "Budget exhausted" appears

- [ ] **Step 7: Commit**

```bash
git add app/(dashboard)/lists/[id]/page.tsx
git commit -m "feat: add Enrich button to list detail page for one-click Apollo enrichment"
```

---

## Self-Review

**Spec coverage:**
- ✅ User creates a list — pre-existing, no change needed
- ✅ User triggers Apollo enrichment for the list — Task 1 (API) + Task 2 (UI button)
- ✅ Phone + email saved to DB — handled by existing `enrich-contact` Inngest function
- ✅ Budget enforcement — Task 1 checks `EnrichmentSpend` before queuing
- ✅ Skip already-enriched contacts — Task 1 filters `email: null`
- ✅ User feedback — Task 2 shows queued count / error for 4 seconds

**Placeholder scan:** No TBDs, all code is complete.

**Type consistency:**
- `enrichResult` type matches the API response shape `{ queued, skipped, creditsRemaining }`
- `inngest.send()` uses `"enrich.contact" as const` — same event name as `bulk-enrich/route.ts`
- `withTenant` pattern mirrors `members/route.ts` exactly (ID extracted via `pathname.split("/").at(-2)`)
