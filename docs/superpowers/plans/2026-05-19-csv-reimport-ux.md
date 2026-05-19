# CSV Re-Import UX & Smart Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make re-uploading the same (or updated) LinkedIn connections CSV feel idempotent and intelligent — no wasted Apollo credits, no duplicate work, clear feedback about what changed, and soft-removal of contacts that left the user's network.

**Architecture:** Three layers. (1) **Import history**: a new `Import` table records every upload with stats. (2) **Differential upsert** in the CSV route returns `{added, updated, removed, unchanged}` counts, and marks contacts that vanished from the new CSV with `removedAt`. (3) **Idempotent enrichment**: after each import we emit `companies.enrich-web` which already has a DB-first cache — but we also expose progress via the existing SSE bus so the contacts page shows a live "Enriching N of M companies…" banner.

**Tech Stack:** Next.js 16, Prisma 7, Inngest 4, Apollo Enrichment API (X-Api-Key header), SSE via `publish()` in `lib/linkedin/sse-bus.ts`, Vitest.

**Working directory:** `~/linkedin-sales-intelligence`

---

## Context — what's already in place

Before adding anything, here's what's already idempotent today (confirmed by reading the existing code):

- **Contact upsert** by `(ownerId, linkedinUrn)` — re-importing the same CSV updates existing rows in place. ✓
- **Company stub upsert** by `universalName` (slugified company name) — re-importing creates no duplicate companies. ✓
- **Apollo enrichment** in `inngest/functions/enrich-companies-web.ts` already filters `where: { staffCount: null }` and re-checks each row inside the batch (`fresh.staffCount != null` guard) — already-enriched companies cost zero Apollo credits on re-runs. ✓
- **Apollo two-step lookup** (search by name → get domain → enrich by domain) using `X-Api-Key` header — works (Mobileye returned 3,900 employees, automotive). ✓

What's **missing** for the high-end UX the user described:

1. The CSV import API disabled the auto-enrich trigger when we were using DuckDuckGo (low quality). Apollo is high quality — re-enable it.
2. No record of when a CSV was last uploaded; no audit trail.
3. Contacts that drop out of a new CSV (user removed someone on LinkedIn) keep showing in the table forever.
4. The user has zero visibility into what's happening after they click "Upload" — the import succeeds but the enrichment runs invisibly in the background.
5. The import result shows totals (`imported, created, updated, companies`) but doesn't tell the user how many will hit Apollo vs. how many are already cached.

This plan closes those five gaps.

---

## File Structure

### New files
- `prisma/schema.prisma` — add `Import` model (declared in Task 1).
- `lib/linkedin/sse-bus.ts` — already exists; we add two event types (`linkedin:enrich-progress`, `linkedin:enrich-done`) without changing the file's signature.
- `tests/unit/csv-diff.test.ts` — tests the new `diffContacts()` helper.
- `lib/csv/diff.ts` — pure helper: given the existing contacts in the DB and the new CSV rows, returns `{added, updated, removed, unchanged}`.
- `components/dashboard/enrich-banner.tsx` — small SSE-driven banner shown on `/contacts` while enrichment is running.

### Modified files
- `prisma/schema.prisma` — add `Import` model + relation on `User`.
- `app/api/import/csv/route.ts` — call `diffContacts`, persist `Import` row, soft-mark removed contacts, re-enable `companies.enrich-web` event with `orgId` payload.
- `inngest/functions/enrich-companies-web.ts` — emit SSE progress events on each batch via `publish(userId, {type: "linkedin:enrich-progress", ...})`.
- `app/(dashboard)/import/page.tsx` — show extended import result (added / updated / removed / will-enrich / already-cached).
- `app/(dashboard)/contacts/page.tsx` — mount `<EnrichBanner />` at the top.
- `app/api/sse/stream/route.ts` — already exists; nothing to change (just confirm it forwards new event types).

### Untouched
- The Apollo client. Already works.
- The contact table component. Already shows `company.staffCount` and `company.industry`.
- The infinite-scroll pagination. Already works.

---

## Task 1: `Import` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma db push` (we use `db push` not `migrate dev` because the dev DB has schema drift from earlier — confirmed in earlier sessions).

- [ ] **Step 1: Add the `Import` model**

Open `prisma/schema.prisma`. Find the line `model Invite {` (added in an earlier session) and insert this block right after the closing `}` of `Invite`:

```prisma
model Import {
  id          String   @id @default(cuid())
  ownerId    String
  fileName   String
  totalRows  Int      // raw rows in the uploaded file
  added      Int      // contacts that did not previously exist
  updated    Int      // contacts that existed and were refreshed
  removed    Int      // contacts present in DB but absent from this CSV (soft-removed)
  companies  Int      // unique non-empty company strings in this CSV
  newCompanies Int    // companies created (didn't exist in DB before this import)
  createdAt  DateTime @default(now())

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId, createdAt])
}
```

- [ ] **Step 2: Add the inverse relation to `User`**

In the same file, find the `model User` block. Look for the existing list of relation arrays (`accounts Account[]`, `contacts Contact[]`, etc.) and add this line at the end of that group, before the `@@` block-level attributes:

```prisma
  imports         Import[]
```

- [ ] **Step 3: Push schema to DB**

```bash
cd ~/linkedin-sales-intelligence
npx prisma db push
```

Expected output: `🚀  Your database is now in sync with your Prisma schema. Done in XXms`

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client (7.x.x) to ./lib/generated/prisma`

- [ ] **Step 5: Restore the hand-written index shim if Prisma generate deleted it**

Check:
```bash
cat lib/generated/prisma/index.ts
```

If the file is missing or empty, recreate it:
```bash
echo "export * from './client';" > lib/generated/prisma/index.ts
```

- [ ] **Step 6: Verify it compiled**

```bash
cd ~/linkedin-sales-intelligence
npx tsc --noEmit 2>&1 | grep -E "Import|prisma" | head -5
```

Expected: no errors mentioning the `Import` model.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma lib/generated/prisma/
git commit -m "feat(db): add Import model to track CSV upload history"
```

---

## Task 2: Pure `diffContacts` helper (TDD)

**Files:**
- Create: `lib/csv/diff.ts`
- Test: `tests/unit/csv-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/csv-diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffContacts } from "@/lib/csv/diff";

describe("diffContacts", () => {
  it("classifies brand-new linkedinUrns as added", () => {
    const existing = new Map<string, { fullName: string; currentTitle: string | null; currentCompany: string | null }>();
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme" },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.added).toEqual(["urn:1"]);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it("classifies same name+title+company as unchanged", () => {
    const existing = new Map([
      ["urn:1", { fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme" }],
    ]);
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme" },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.unchanged).toEqual(["urn:1"]);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  it("classifies same urn but different title as updated", () => {
    const existing = new Map([
      ["urn:1", { fullName: "Alice", currentTitle: "CTO", currentCompany: "Acme" }],
    ]);
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme" },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.updated).toEqual(["urn:1"]);
  });

  it("classifies existing urns missing from incoming as removed", () => {
    const existing = new Map([
      ["urn:1", { fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme" }],
      ["urn:2", { fullName: "Bob",   currentTitle: "CFO", currentCompany: "Beta" }],
    ]);
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme" },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.removed).toEqual(["urn:2"]);
    expect(result.unchanged).toEqual(["urn:1"]);
  });

  it("handles empty inputs", () => {
    expect(diffContacts(new Map(), [])).toEqual({
      added: [], updated: [], removed: [], unchanged: [],
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd ~/linkedin-sales-intelligence
npx vitest run tests/unit/csv-diff.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '@/lib/csv/diff'`

- [ ] **Step 3: Implement the helper**

Create `lib/csv/diff.ts`:

```ts
export type ContactSnapshot = {
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
};

export type IncomingContact = ContactSnapshot & { linkedinUrn: string };

export type ContactDiff = {
  added: string[];      // linkedinUrns in incoming but not in existing
  updated: string[];    // in both, but at least one field changed
  removed: string[];    // in existing but not in incoming
  unchanged: string[];  // in both, identical
};

function isSameSnapshot(a: ContactSnapshot, b: ContactSnapshot): boolean {
  return (
    (a.fullName ?? "") === (b.fullName ?? "") &&
    (a.currentTitle ?? "") === (b.currentTitle ?? "") &&
    (a.currentCompany ?? "") === (b.currentCompany ?? "")
  );
}

export function diffContacts(
  existing: Map<string, ContactSnapshot>,
  incoming: IncomingContact[],
): ContactDiff {
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const incomingUrns = new Set<string>();

  for (const c of incoming) {
    incomingUrns.add(c.linkedinUrn);
    const prev = existing.get(c.linkedinUrn);
    if (!prev) {
      added.push(c.linkedinUrn);
    } else if (isSameSnapshot(prev, c)) {
      unchanged.push(c.linkedinUrn);
    } else {
      updated.push(c.linkedinUrn);
    }
  }

  const removed = [...existing.keys()].filter((urn) => !incomingUrns.has(urn));

  return { added, updated, removed, unchanged };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/csv-diff.test.ts 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/diff.ts tests/unit/csv-diff.test.ts
git commit -m "feat(csv): pure diffContacts helper with TDD coverage"
```

---

## Task 3: Wire diff + history + soft-remove into the import API

**Files:**
- Modify: `app/api/import/csv/route.ts`

- [ ] **Step 1: Read the existing import route**

```bash
cat ~/linkedin-sales-intelligence/app/api/import/csv/route.ts | head -50
```

Confirm the file starts with `import { NextRequest, NextResponse } from "next/server";` and the POST handler is wrapped in `withTenant`. The body of the handler does (in order): parse the file → upsert contacts → stub companies → link contacts → return JSON.

- [ ] **Step 2: Add new imports at the top**

Open `app/api/import/csv/route.ts`. After the existing imports (after the `import * as XLSX from "xlsx"` line), add:

```ts
import { diffContacts, type IncomingContact } from "@/lib/csv/diff";
```

- [ ] **Step 3: Replace the contact-upsert loop with the diff-first version**

Find the block that starts with `// Upsert contacts` and ends just before `// Stub Company rows and link contacts`. Replace the entire block (the loop that does `for (const c of contacts) { ... prisma.contact.upsert ... }`) with:

```ts
  // Upsert contacts via diff-first strategy
  const userId = ctx.effectiveUserId;

  // Load existing contacts for this user — only the fields we compare
  const existingRows = await prisma.contact.findMany({
    where: { ownerId: userId, removedAt: null },
    select: { linkedinUrn: true, fullName: true, currentTitle: true, currentCompany: true },
  });
  const existingMap = new Map(
    existingRows.map((r: { linkedinUrn: string; fullName: string; currentTitle: string | null; currentCompany: string | null }) =>
      [r.linkedinUrn, { fullName: r.fullName, currentTitle: r.currentTitle, currentCompany: r.currentCompany }],
    ),
  );

  const incoming: IncomingContact[] = contacts.map((c) => ({
    linkedinUrn: c.linkedinUrn,
    fullName: c.fullName,
    currentTitle: c.currentTitle,
    currentCompany: c.currentCompany,
  }));

  const diff = diffContacts(existingMap, incoming);

  // Apply ADD + UPDATE in one pass (the diff lets us pick which ones to touch — UNCHANGED rows are skipped entirely)
  const toUpsert = contacts.filter((c) => !diff.unchanged.includes(c.linkedinUrn));
  for (const c of toUpsert) {
    const { seniority, function: fn } = classify(c.currentTitle ?? "");
    await prisma.contact.upsert({
      where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: c.linkedinUrn } },
      create: {
        ownerId: userId,
        linkedinUrn: c.linkedinUrn,
        linkedinUrl: c.linkedinUrl,
        fullName: c.fullName,
        email: c.email,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        seniority,
        function: fn,
        connectedAt: c.connectedAt,
        lastSyncedAt: new Date(),
      },
      update: {
        fullName: c.fullName,
        email: c.email || undefined,
        currentTitle: c.currentTitle || undefined,
        currentCompany: c.currentCompany || undefined,
        seniority,
        function: fn,
        connectedAt: c.connectedAt || undefined,
        lastSyncedAt: new Date(),
        removedAt: null,  // un-soft-remove if they came back
      },
    });
  }

  // Soft-remove contacts that vanished from this CSV
  if (diff.removed.length > 0) {
    await prisma.contact.updateMany({
      where: { ownerId: userId, linkedinUrn: { in: diff.removed } },
      data: { removedAt: new Date() },
    });
  }

  const created = diff.added.length;
  const updated = diff.updated.length;
  const removed = diff.removed.length;
  const unchanged = diff.unchanged.length;
- [ ] **Step 4: Count "newCompanies" before stubbing them**

Find the block that starts with `// Stub Company rows and link contacts`. Just before the `await prisma.$transaction(...)` call that creates Company rows, add this lookup so we can report how many of the slugs were newly created:

```ts
    // Count how many of these slugs are brand new (not in DB yet)
    const existingCompanies = await prisma.company.findMany({
      where: { universalName: { in: [...bySlug.keys()] } },
      select: { universalName: true },
    });
    const existingSlugs = new Set(existingCompanies.map((r: { universalName: string }) => r.universalName));
    const newCompanies = [...bySlug.keys()].filter((s) => !existingSlugs.has(s)).length;
```

Then in the JSON response at the bottom, expose this stat (see Step 6).

- [ ] **Step 5: Re-enable the auto-enrichment trigger**

In the same file, find the line `// Web enrichment not auto-triggered — run manually from Admin when ready` and replace it with:

```ts
    // Auto-trigger Apollo enrichment for any companies that still need data
    // (the function itself filters staffCount=null, so re-runs cost zero credits)
    const meForOrg = await prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });
    if (meForOrg) {
      await inngest.send({
        name: "companies.enrich-web" as const,
        data: { orgId: meForOrg.orgId },
      });
    }
```

- [ ] **Step 6: Record the Import row and return richer stats**

At the bottom of the handler, find:

```ts
  return NextResponse.json({
    ok: true,
    imported: contacts.length,
    created,
    updated,
    companies: bySlug.size,
  });
});
```

Replace with:

```ts
  // Persist import history
  await prisma.import.create({
    data: {
      ownerId: userId,
      fileName: file.name,
      totalRows: contacts.length,
      added: created,
      updated,
      removed,
      companies: bySlug.size,
      newCompanies,
    },
  });

  return NextResponse.json({
    ok: true,
    imported: contacts.length,
    added: created,
    updated,
    removed,
    unchanged,
    companies: bySlug.size,
    newCompanies,
  });
});
```

- [ ] **Step 7: Type-check**

```bash
cd ~/linkedin-sales-intelligence
npx tsc --noEmit 2>&1 | grep "import/csv" | head -10
```

Expected: no errors.

- [ ] **Step 8: Manual smoke test**

```bash
# Make sure dev server is running, then upload a small CSV via the UI.
# Re-upload the same CSV — should report 0 added, X unchanged, 0 newCompanies.
# After modifying one row in the CSV, re-upload — should report 0 added, 1 updated.
```

- [ ] **Step 9: Commit**

```bash
git add app/api/import/csv/route.ts
git commit -m "feat(import): diff-first upsert, soft-remove, history table, auto-enrichment"
```

---

## Task 4: Update import UI to show the rich result

**Files:**
- Modify: `app/(dashboard)/import/page.tsx`

- [ ] **Step 1: Update the `ImportResult` type**

In `app/(dashboard)/import/page.tsx`, find:

```ts
type ImportResult = {
  imported: number;
  created: number;
  updated: number;
  companies: number;
};
```

Replace with:

```ts
type ImportResult = {
  imported: number;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  companies: number;
  newCompanies: number;
};
```

- [ ] **Step 2: Update the success card's stat grid**

Find the JSX block that renders three `<StatCard>` components after the "Import complete!" message. Replace the entire `<div className="grid grid-cols-3 gap-3">...</div>` block with:

```tsx
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={FileSpreadsheet} label="Total in file" value={result.imported} />
              <StatCard icon={Users} label="New contacts" value={result.added} />
              <StatCard icon={Users} label="Updated" value={result.updated} accent="info" />
              <StatCard icon={Users} label="Removed" value={result.removed} accent={result.removed > 0 ? "warn" : undefined} />
              <StatCard icon={Building2} label="Companies in file" value={result.companies} />
              <StatCard icon={Building2} label="New companies" value={result.newCompanies} accent="info" />
            </div>

            {result.newCompanies > 0 && (
              <div className="px-4 py-3 rounded-lg bg-[#1585ff]/8 border border-[#1585ff]/20 text-xs text-[#9ecfff]">
                Enriching {result.newCompanies} new companies in the background — employee counts and industries will appear in the table as they come in.
              </div>
            )}

            {result.unchanged > 0 && (
              <p className="text-xs text-[#456078] text-center">
                {result.unchanged.toLocaleString()} contacts were already up to date — skipped.
              </p>
            )}
```

- [ ] **Step 3: Update `StatCard` to accept an `accent` prop**

Find the `function StatCard(...)` at the bottom of the file. Replace its signature and body with:

```tsx
function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accent?: "info" | "warn";
}) {
  const colorByAccent: Record<NonNullable<typeof accent>, { ring: string; text: string }> = {
    info: { ring: "border-[#1585ff]/30", text: "text-[#9ecfff]" },
    warn: { ring: "border-amber-500/30", text: "text-amber-400" },
  };
  const c = accent ? colorByAccent[accent] : { ring: "border-[#25405e]", text: "text-[#eaf2fd]" };
  return (
    <div className={`rounded-xl border ${c.ring} bg-[#1a2d3f] p-4 text-center`}>
      <Icon className="w-5 h-5 text-[#5c7d9e] mx-auto mb-2" />
      <p className={`text-xl font-semibold ${c.text}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-[#5c7d9e] mt-0.5">{label}</p>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "import/page" | head -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/import/page.tsx
git commit -m "feat(import-ui): show add/update/remove/unchanged + new-companies stats"
```

---

## Task 5: SSE enrichment progress events

**Files:**
- Modify: `inngest/functions/enrich-companies-web.ts`
- Create: `components/dashboard/enrich-banner.tsx`
- Modify: `app/(dashboard)/contacts/page.tsx`

- [ ] **Step 1: Emit progress events from the Inngest function**

Open `inngest/functions/enrich-companies-web.ts`. Add this import at the top, after the existing imports:

```ts
import { publish } from "@/lib/linkedin/sse-bus";
```

Then find the line `if (companies.length === 0) return { enriched: 0, total: 0, skipped: 0 };` and just BEFORE it, capture the user IDs we need to notify. Find the `companies = await step.run("load-unenriched", ...)` block — replace its body so it also fetches the relevant owner IDs:

```ts
    const companies = await step.run("load-unenriched", () =>
      prisma.company.findMany({
        where: {
          staffCount: null,
          name: { not: "" },
          ...(orgId ? { contacts: { some: { owner: { orgId } } } } : {}),
        },
        select: {
          id: true,
          universalName: true,
          name: true,
          _count: { select: { contacts: true } },
        },
        orderBy: { contacts: { _count: "desc" } },
      }),
    );

    // Capture the set of owners affected by this run so we can notify them
    const ownerIds = await step.run("load-affected-owners", async () => {
      if (companies.length === 0) return [] as string[];
      const rows = await prisma.contact.findMany({
        where: { companyId: { in: companies.map((c: { id: string }) => c.id) } },
        distinct: ["ownerId"],
        select: { ownerId: true },
      });
      return rows.map((r: { ownerId: string }) => r.ownerId);
    });

    function notify(payload: { processed: number; total: number; done?: boolean }) {
      for (const uid of ownerIds) {
        publish(uid, {
          type: payload.done ? "linkedin:enrich-done" : "linkedin:enrich-progress",
          data: payload,
        });
      }
    }

    notify({ processed: 0, total: companies.length });
```

- [ ] **Step 2: Emit progress after each batch + a final "done" event**

Find the `totalEnriched += enriched;` line at the end of the `for (let i = 0; i < companies.length; i += BATCH)` loop. Right after that line, add:

```ts
      notify({ processed: i + batch.length, total: companies.length });
```

And just before the final `return { enriched: totalEnriched, ... };` add:

```ts
    notify({ processed: companies.length, total: companies.length, done: true });
```

- [ ] **Step 3: Create the banner component**

Create `components/dashboard/enrich-banner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

type Progress = { processed: number; total: number };

export default function EnrichBanner() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/sse/stream");

    es.addEventListener("linkedin:enrich-progress", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Progress;
      setProgress(data);
    });

    es.addEventListener("linkedin:enrich-done", () => {
      setProgress(null);
      setDismissed(false);
    });

    return () => es.close();
  }, []);

  if (!progress || dismissed) return null;
  const pct = progress.total === 0 ? 100 : Math.round((progress.processed / progress.total) * 100);

  return (
    <div className="mx-4 mt-4 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#1585ff]/10 border border-[#1585ff]/20">
      <Sparkles className="w-4 h-4 text-[#1585ff] shrink-0 animate-pulse" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs text-[#9ecfff]">
          <span>Enriching companies via Apollo…</span>
          <span className="font-mono text-[#5c7d9e]">{progress.processed} / {progress.total}</span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-[#1585ff]/10 overflow-hidden">
          <div className="h-full bg-[#1585ff] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-[#5c7d9e] hover:text-[#9ecfff] transition-colors"
        aria-label="Hide"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Mount the banner on the contacts page**

Open `app/(dashboard)/contacts/page.tsx`. Add this import after the existing component imports:

```ts
import EnrichBanner from "@/components/dashboard/enrich-banner";
```

Find the outer `<div className="min-h-full ...">` that wraps the page content (it's the first JSX element returned). Just inside that div, before the first existing element, add:

```tsx
        <EnrichBanner />
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "enrich-banner|enrich-companies-web|contacts/page" | head -5
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add inngest/functions/enrich-companies-web.ts components/dashboard/enrich-banner.tsx app/\(dashboard\)/contacts/page.tsx
git commit -m "feat(enrichment): live SSE progress banner on contacts page"
```

---

## Task 6: End-to-end verification

This is operational — no new files.

- [ ] **Step 1: Make sure everything is running**

In two terminals:
```bash
# Terminal A
cd ~/linkedin-sales-intelligence && npm run dev

# Terminal B
cd ~/linkedin-sales-intelligence && npx inngest-cli@latest dev
```

- [ ] **Step 2: First-time upload (large file, fresh state)**

In a third terminal, take note of the starting state:
```bash
docker compose exec -T postgres psql -U linkedinsi linkedinsi -c \
  'SELECT count(*) FROM "Contact" WHERE "removedAt" IS NULL;
   SELECT count(*) FROM "Company" WHERE "staffCount" IS NOT NULL;
   SELECT count(*) FROM "Import";'
```

Now open `http://localhost:3000/import` and upload your `Connections.csv`. Expected response:
- `imported`: ~22,000
- `added`: small if you've imported before, large if first time
- `removed`: 0
- `unchanged`: most of the existing contacts
- `newCompanies`: 0–few hundred

Watch the contacts page — the **EnrichBanner** should appear within 5 seconds showing `0 / N` and start incrementing.

- [ ] **Step 3: Idempotency check — upload the SAME file again**

Re-upload the same CSV. Expected:
- `added`: 0
- `updated`: 0
- `removed`: 0
- `unchanged`: ~22,000
- `newCompanies`: 0
- **No** banner appears (zero credits spent — the Apollo call inside the function still runs but every company hits the cache and is skipped before the API call)

Verify in DB:
```bash
docker compose exec -T postgres psql -U linkedinsi linkedinsi -c \
  'SELECT "fileName", "added", "updated", "removed", "unchanged" FROM "Import" ORDER BY "createdAt" DESC LIMIT 3;'
```

The second row should show `added: 0, updated: 0`.

- [ ] **Step 4: Soft-remove check — upload a smaller CSV**

Hand-edit your `Connections.csv` to remove the last 10 rows, save it as `Connections-smaller.csv`, and upload it. Expected:
- `removed`: 10
- A SQL check should show 10 contacts now have `removedAt IS NOT NULL`:
```bash
docker compose exec -T postgres psql -U linkedinsi linkedinsi -c \
  'SELECT count(*) FROM "Contact" WHERE "removedAt" IS NOT NULL;'
```

- [ ] **Step 5: Restore check — re-upload the full file**

Upload the original `Connections.csv` again. The 10 soft-removed contacts should be revived:
```bash
docker compose exec -T postgres psql -U linkedinsi linkedinsi -c \
  'SELECT count(*) FROM "Contact" WHERE "removedAt" IS NOT NULL;'
```

Expected: 0.

- [ ] **Step 6: Confirm contacts table only shows non-removed rows**

Open `/contacts` and check the total at the top — it should match `count(*) WHERE removedAt IS NULL`. (The existing API query already filters `removedAt: null`; just confirming nothing broke.)

---

## Verification Checklist

The work is complete when:

- [ ] `npx vitest run tests/unit/csv-diff.test.ts` — 5/5 pass.
- [ ] `npx tsc --noEmit` — no new errors.
- [ ] Re-uploading the same CSV produces `added=0, updated=0, removed=0` and zero Apollo credits spent.
- [ ] Uploading a CSV missing some rows soft-removes those contacts (`removedAt` is set).
- [ ] Re-uploading the original CSV revives the soft-removed contacts (`removedAt` cleared).
- [ ] The EnrichBanner shows live progress on `/contacts` while Apollo runs.
- [ ] The `Import` table has one row per upload with accurate stats.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Loading the full existing contact list into memory for diffing is slow for 50k+ contacts | At 22k contacts × ~80 bytes per row = ~1.7 MB in memory. Fine for a single Node.js request. If it ever grows to millions, replace with batched diffing. |
| Soft-remove is too aggressive — user uploads an old CSV by accident and 5,000 contacts get marked removed | The next correct upload revives them automatically (`update: { removedAt: null }`). For an extra safety net, the `Import` table preserves the count so the user can see "removed: 5000" in the success card and re-upload immediately. |
| Apollo rate-limit during enrichment | The `enrich-companies-web` function already throws on `rate limit` and Inngest retries. We don't need new logic. |
| SSE banner shows progress for `0/0` if user has no unenriched companies | The function returns early when `companies.length === 0`, so no SSE events fire — banner stays hidden. |
| `Import` table grows unbounded | Acceptable. ~1 KB per row; even 10,000 imports = 10 MB. Add a cleanup job only if it becomes an issue. |

---

## Out of Scope (deliberate)

These would also be nice-to-haves, but they are deliberately deferred:

- **Stale enrichment refresh** (e.g., re-enrich companies whose `lastEnrichedAt` is over 90 days old). Add a separate `companies.refresh-stale` event later.
- **Per-company "Refresh data" button** in the contact drawer.
- **Apollo credit budget guard** — refuse to start enrichment if `org.monthlyApolloBudget` would be exceeded. Can layer on later via the existing `EnrichmentSpend` model.
- **CSV column auto-mapping UI** — for now we only support LinkedIn's stock column names. If we ever take CSVs from other sources, build a mapping step.
