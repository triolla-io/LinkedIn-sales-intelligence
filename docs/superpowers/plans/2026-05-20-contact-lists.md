# Contact Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users curate named lists of contacts, use them as campaign audiences, and access them from the contacts filter sidebar and a dedicated /lists page.

**Architecture:** Two new Prisma models (`ContactList` + `ContactListMember`) back a REST API. A shared `ListPopover` component handles add-to-list UI in both the bulk toolbar and contact drawer. The contacts API gains a `listId` filter param; the campaigns API gains `listId` as an audience source.

**Tech Stack:** Next.js App Router, Prisma ORM (PostgreSQL), React, Tailwind CSS, Zod, Vitest

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `prisma/schema.prisma` | Add `ContactList`, `ContactListMember` models; add back-relations |
| Create | `app/api/lists/route.ts` | GET all lists, POST create list |
| Create | `app/api/lists/[id]/route.ts` | GET detail, PATCH rename, DELETE |
| Create | `app/api/lists/[id]/members/route.ts` | POST add/remove members |
| Modify | `app/api/contacts/route.ts` | Add `listId` query param |
| Modify | `app/api/campaigns/route.ts` | Accept `listId` as audience source |
| Create | `components/dashboard/list-popover.tsx` | Shared popover: pick/create lists |
| Modify | `components/dashboard/bulk-enrich-bar.tsx` | Add "Save to List" button |
| Modify | `components/dashboard/contact-drawer.tsx` | Add Lists section |
| Modify | `components/dashboard/filter-sidebar.tsx` | Add Lists section at top; add `listId` to `Filters` type |
| Modify | `app/(dashboard)/contacts/page.tsx` | Wire `listId` through filter state + URL |
| Create | `app/(dashboard)/lists/page.tsx` | Lists index page |
| Create | `app/(dashboard)/lists/[id]/page.tsx` | List detail page |
| Modify | `components/dashboard/sidebar.tsx` | Add Lists nav item |
| Modify | `components/dashboard/new-campaign-modal.tsx` | Accept `listId` prop |
| Create | `tests/unit/lists-api.test.ts` | Unit tests for list query helpers |

---

## Task 1: Schema — Add ContactList + ContactListMember

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add models to schema**

Open `prisma/schema.prisma`. After the `Import` model at the end of the file, append:

```prisma
model ContactList {
  id        String   @id @default(cuid())
  ownerId   String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner   User                @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  members ContactListMember[]

  @@index([ownerId])
}

model ContactListMember {
  listId    String
  contactId String
  addedAt   DateTime @default(now())

  list    ContactList @relation(fields: [listId], references: [id], onDelete: Cascade)
  contact Contact     @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@id([listId, contactId])
  @@index([contactId])
}
```

- [ ] **Step 2: Add back-relations to User and Contact**

In the `User` model, after the `imports` relation line, add:
```prisma
  contactLists    ContactList[]
```

In the `Contact` model, after the `campaignRecipients` relation line, add:
```prisma
  lists           ContactListMember[]
```

- [ ] **Step 3: Generate and run migration**

```bash
cd /Users/ariellunenfeld/linkedin-sales-intelligence
npx prisma migrate dev --name add-contact-lists
```

Expected: migration file created, client regenerated, no errors.

- [ ] **Step 4: Verify generated client**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add ContactList and ContactListMember models"
```

---

## Task 2: API — GET /api/lists + POST /api/lists

**Files:**
- Create: `app/api/lists/route.ts`
- Create: `tests/unit/lists-api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/lists-api.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Helper that builds the "where" clause for listing user lists
function buildListsWhere(ownerId: string) {
  return { ownerId };
}

// Helper that parses create-list body
function parseCreateBody(body: unknown): { name: string; contactIds?: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (b.contactIds !== undefined && !Array.isArray(b.contactIds)) return null;
  return { name: b.name.trim(), contactIds: b.contactIds as string[] | undefined };
}

describe("buildListsWhere", () => {
  it("returns ownerId filter", () => {
    expect(buildListsWhere("user-1")).toEqual({ ownerId: "user-1" });
  });
});

describe("parseCreateBody", () => {
  it("accepts valid name", () => {
    expect(parseCreateBody({ name: "My List" })).toEqual({ name: "My List", contactIds: undefined });
  });
  it("trims whitespace", () => {
    expect(parseCreateBody({ name: "  List  " })).toEqual({ name: "List", contactIds: undefined });
  });
  it("accepts contactIds array", () => {
    expect(parseCreateBody({ name: "L", contactIds: ["a", "b"] })).toEqual({ name: "L", contactIds: ["a", "b"] });
  });
  it("rejects missing name", () => {
    expect(parseCreateBody({})).toBeNull();
  });
  it("rejects empty name", () => {
    expect(parseCreateBody({ name: "  " })).toBeNull();
  });
  it("rejects non-array contactIds", () => {
    expect(parseCreateBody({ name: "L", contactIds: "bad" })).toBeNull();
  });
  it("rejects non-object body", () => {
    expect(parseCreateBody(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/lists-api.test.ts
```

Expected: FAIL — `buildListsWhere` and `parseCreateBody` are not defined yet.

- [ ] **Step 3: Create the route — implement helpers + handlers**

Create `app/api/lists/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export function buildListsWhere(ownerId: string) {
  return { ownerId };
}

export function parseCreateBody(body: unknown): { name: string; contactIds?: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (b.contactIds !== undefined && !Array.isArray(b.contactIds)) return null;
  return { name: b.name.trim(), contactIds: b.contactIds as string[] | undefined };
}

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const lists = await prisma.contactList.findMany({
    where: buildListsWhere(ctx.effectiveUserId),
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ lists: lists.map((l) => ({ id: l.id, name: l.name, memberCount: l._count.members, createdAt: l.createdAt })) });
});

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  const parsed = parseCreateBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const list = await prisma.contactList.create({
    data: {
      ownerId: ctx.effectiveUserId,
      name: parsed.name,
      ...(parsed.contactIds?.length
        ? {
            members: {
              createMany: {
                data: parsed.contactIds.map((contactId) => ({ contactId })),
                skipDuplicates: true,
              },
            },
          }
        : {}),
    },
  });

  return NextResponse.json({ list }, { status: 201 });
});
```

- [ ] **Step 4: Update tests to import from route**

Update `tests/unit/lists-api.test.ts` — replace the inline helper definitions with imports:

```typescript
import { describe, it, expect } from "vitest";
import { buildListsWhere, parseCreateBody } from "@/app/api/lists/route";

describe("buildListsWhere", () => {
  it("returns ownerId filter", () => {
    expect(buildListsWhere("user-1")).toEqual({ ownerId: "user-1" });
  });
});

describe("parseCreateBody", () => {
  it("accepts valid name", () => {
    expect(parseCreateBody({ name: "My List" })).toEqual({ name: "My List", contactIds: undefined });
  });
  it("trims whitespace", () => {
    expect(parseCreateBody({ name: "  List  " })).toEqual({ name: "List", contactIds: undefined });
  });
  it("accepts contactIds array", () => {
    expect(parseCreateBody({ name: "L", contactIds: ["a", "b"] })).toEqual({ name: "L", contactIds: ["a", "b"] });
  });
  it("rejects missing name", () => {
    expect(parseCreateBody({})).toBeNull();
  });
  it("rejects empty name", () => {
    expect(parseCreateBody({ name: "  " })).toBeNull();
  });
  it("rejects non-array contactIds", () => {
    expect(parseCreateBody({ name: "L", contactIds: "bad" })).toBeNull();
  });
  it("rejects non-object body", () => {
    expect(parseCreateBody(null)).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/lists-api.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/lists/route.ts tests/unit/lists-api.test.ts
git commit -m "feat(api): add GET/POST /api/lists"
```

---

## Task 3: API — GET/PATCH/DELETE /api/lists/[id]

**Files:**
- Create: `app/api/lists/[id]/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/lists/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export const GET = withTenant(async (req: NextRequest, ctx) => {
  // withTenant discards route params; extract ID from URL pathname
  const id = req.nextUrl.pathname.split("/").at(-1)!;

  const list = await prisma.contactList.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    include: { _count: { select: { members: true } } },
  });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = Number(req.nextUrl.searchParams.get("page") ?? 1);
  const pageSize = Number(req.nextUrl.searchParams.get("pageSize") ?? 20);

  const members = await prisma.contactListMember.findMany({
    where: { listId: id },
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { addedAt: "desc" },
    include: {
      contact: {
        select: {
          id: true, fullName: true, headline: true, currentTitle: true,
          currentCompany: true, companySize: true, seniority: true,
          function: true, location: true, industry: true, email: true,
          phone: true, lastSyncedAt: true, linkedinUrl: true,
          company: { select: { staffCount: true, industry: true } },
        },
      },
    },
  });

  return NextResponse.json({
    list: { id: list.id, name: list.name, memberCount: list._count.members, createdAt: list.createdAt },
    contacts: members.map((m) => m.contact),
    page,
    pageSize,
    total: list._count.members,
  });
});

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : null;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const existing = await prisma.contactList.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.contactList.update({ where: { id }, data: { name } });
  return NextResponse.json({ list: updated });
});

export const DELETE = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const existing = await prisma.contactList.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.contactList.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add app/api/lists/[id]/route.ts
git commit -m "feat(api): add GET/PATCH/DELETE /api/lists/[id]"
```

---

## Task 4: API — POST /api/lists/[id]/members

**Files:**
- Create: `app/api/lists/[id]/members/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/lists/[id]/members/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const POST = withTenant(async (req: NextRequest, ctx) => {
  // Path: /api/lists/{id}/members — ID is second-to-last segment
  const id = req.nextUrl.pathname.split("/").at(-2)!;

  const existing = await prisma.contactList.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const add: string[] = Array.isArray(body.add) ? body.add : [];
  const remove: string[] = Array.isArray(body.remove) ? body.remove : [];

  await prisma.$transaction([
    ...(add.length
      ? [
          prisma.contactListMember.createMany({
            data: add.map((contactId) => ({ listId: id, contactId })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...(remove.length
      ? [
          prisma.contactListMember.deleteMany({
            where: { listId: id, contactId: { in: remove } },
          }),
        ]
      : []),
  ]);

  const memberCount = await prisma.contactListMember.count({ where: { listId: id } });
  return NextResponse.json({ ok: true, memberCount });
});
```

- [ ] **Step 2: Commit**

```bash
git add app/api/lists/[id]/members/route.ts
git commit -m "feat(api): add POST /api/lists/[id]/members"
```

---

## Task 5: Update /api/contacts to support listId filter

**Files:**
- Modify: `app/api/contacts/route.ts`

- [ ] **Step 1: Add listId to querySchema**

In `app/api/contacts/route.ts`, find the `querySchema` definition and add `listId` to it:

```typescript
const querySchema = z.object({
  // ... existing fields ...
  listId: z.string().optional(),
});
```

Also add `listId` to the `raw` object that feeds `querySchema.safeParse`:

```typescript
const raw = {
  // ... existing fields ...
  listId: url.searchParams.get("listId") ?? undefined,
};
```

- [ ] **Step 2: Add listId to the where clause**

In the `where` object construction (after `removedAt: null`), add:

```typescript
...(params.listId
  ? {
      lists: {
        some: { listId: params.listId },
      },
    }
  : {}),
```

- [ ] **Step 3: Commit**

```bash
git add app/api/contacts/route.ts
git commit -m "feat(api): add listId filter to /api/contacts"
```

---

## Task 6: Update /api/campaigns to accept listId

**Files:**
- Modify: `app/api/campaigns/route.ts`

- [ ] **Step 1: Update POST handler to accept listId**

In `app/api/campaigns/route.ts`, update the destructure and validation in the POST handler:

```typescript
export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json();
  const { name, templateId, contactIds, listId, filter } = body as {
    name?: string;
    templateId?: string;
    contactIds?: string[];
    listId?: string;
    filter?: unknown;
  };

  if (!name || !templateId) {
    return NextResponse.json({ error: "name and templateId required" }, { status: 400 });
  }
  if (!contactIds && !listId && filter === undefined) {
    return NextResponse.json({ error: "contactIds, listId, or filter required" }, { status: 400 });
  }

  const tpl = await prisma.messageTemplate.findFirst({ where: { id: templateId, ownerId: ctx.effectiveUserId } });
  if (!tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });

  // Resolve listId → contactIds at creation time
  let resolvedContactIds = contactIds;
  if (listId && !resolvedContactIds) {
    const list = await prisma.contactList.findFirst({
      where: { id: listId, ownerId: ctx.effectiveUserId },
    });
    if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });
    const members = await prisma.contactListMember.findMany({
      where: { listId },
      select: { contactId: true },
    });
    resolvedContactIds = members.map((m) => m.contactId);
  }

  const filterJson = resolvedContactIds ? { contactIds: resolvedContactIds } : { filter };
  const campaign = await prisma.campaign.create({
    data: {
      ownerId: ctx.effectiveUserId,
      orgId: ctx.org.id,
      name,
      channel: "LINKEDIN",
      templateId,
      status: "DRAFT",
      filterJson: filterJson as never,
    },
  });
  return NextResponse.json({ campaign }, { status: 201 });
});
```

- [ ] **Step 2: Commit**

```bash
git add app/api/campaigns/route.ts
git commit -m "feat(api): campaigns POST accepts listId as audience source"
```

---

## Task 7: ListPopover component

**Files:**
- Create: `components/dashboard/list-popover.tsx`

- [ ] **Step 1: Create the component**

Create `components/dashboard/list-popover.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type ListSummary = { id: string; name: string; memberCount: number };

interface ListPopoverProps {
  contactIds: string[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
}

export default function ListPopover({ contactIds, onClose, anchorRef }: ListPopoverProps) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // listId or "new"
  const [loading, setLoading] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/lists")
      .then((r) => r.json())
      .then((d) => setLists(d.lists ?? []))
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  async function addToList(listId: string) {
    setBusy(listId);
    await fetch(`/api/lists/${listId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ add: contactIds }),
    });
    setBusy(null);
    onClose();
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy("new");
    await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contactIds }),
    });
    setBusy(null);
    onClose();
  }

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 w-56 bg-[#1a2d3f] border border-[#25405e] rounded-xl shadow-2xl shadow-black/40 py-1 overflow-hidden"
    >
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 text-[#5c7d9e] animate-spin" />
        </div>
      ) : (
        <>
          {lists.length === 0 && (
            <p className="px-3 py-2 text-xs text-[#456078]">No lists yet</p>
          )}
          {lists.map((list) => (
            <button
              key={list.id}
              onClick={() => addToList(list.id)}
              disabled={busy === list.id}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-[#eaf2fd] hover:bg-[#1c3048] transition-colors text-left"
            >
              <span className="truncate">{list.name}</span>
              <span className="shrink-0 text-[#456078]">{list.memberCount}</span>
              {busy === list.id && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
            </button>
          ))}
          <div className="border-t border-[#1e3248] mt-1 pt-1 px-2 pb-2">
            <div className="flex gap-1">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
                placeholder="New list…"
                autoFocus
                className="flex-1 min-w-0 bg-[#14223a] border border-[#25405e] rounded-md px-2 py-1 text-xs text-[#eaf2fd] placeholder-[#456078] focus:outline-none focus:border-[#1585ff]/60"
              />
              <button
                onClick={createAndAdd}
                disabled={!newName.trim() || busy === "new"}
                className="shrink-0 p-1.5 rounded-md bg-[#1585ff] disabled:opacity-40 hover:bg-[#3090ff] transition-colors"
              >
                {busy === "new" ? (
                  <Loader2 className="w-3 h-3 text-white animate-spin" />
                ) : (
                  <Plus className="w-3 h-3 text-white" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/list-popover.tsx
git commit -m "feat(ui): add ListPopover component"
```

---

## Task 8: Update BulkEnrichBar — Add "Save to List" button

**Files:**
- Modify: `components/dashboard/bulk-enrich-bar.tsx`

- [ ] **Step 1: Add Save to List button with popover**

In `components/dashboard/bulk-enrich-bar.tsx`:

1. Add imports at the top:
```typescript
import { Bookmark } from "lucide-react";
import ListPopover from "./list-popover";
```

2. Add state inside the component (after the existing `useState` calls):
```typescript
const [showListPopover, setShowListPopover] = useState(false);
const listBtnRef = useRef<HTMLButtonElement>(null);
```

3. Add `useRef` to the imports from React at the top:
```typescript
import { useState, useRef } from "react";
```

4. Add the button in the "Right: actions" div, before the Enrich button:
```typescript
<div className="relative">
  <button
    ref={listBtnRef}
    onClick={() => setShowListPopover((v) => !v)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#9ecfff] border border-[#9ecfff]/20 hover:bg-[#9ecfff]/10 hover:border-[#9ecfff]/40 rounded-md transition-all"
  >
    <Bookmark className="w-3.5 h-3.5" />
    Save to List
  </button>
  {showListPopover && (
    <ListPopover
      contactIds={selectedIds}
      onClose={() => setShowListPopover(false)}
      anchorRef={listBtnRef as React.RefObject<HTMLElement>}
    />
  )}
</div>
```

- [ ] **Step 2: Verify the file looks correct**

```bash
npx tsc --noEmit 2>&1 | grep bulk-enrich-bar
```

Expected: no errors for that file.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/bulk-enrich-bar.tsx
git commit -m "feat(ui): add Save to List button to BulkEnrichBar"
```

---

## Task 9: Update ContactDrawer — Add Lists section

**Files:**
- Modify: `components/dashboard/contact-drawer.tsx`

- [ ] **Step 1: Read the full drawer file to find the bottom section**

```bash
wc -l /Users/ariellunenfeld/linkedin-sales-intelligence/components/dashboard/contact-drawer.tsx
```

- [ ] **Step 2: Add Lists section to the drawer**

Add these imports at the top of the file:
```typescript
import { Bookmark, X as XIcon, Plus, Loader2 } from "lucide-react";
import ListPopover from "./list-popover";
```

Add state inside the component function (find where other `useState` calls are):
```typescript
const [contactLists, setContactLists] = useState<{ id: string; name: string }[]>([]);
const [showListPopover, setShowListPopover] = useState(false);
const addListBtnRef = useRef<HTMLButtonElement>(null);
```

Add `useRef` to the React imports if not already present.

Fetch contact's lists when drawer opens (add inside the existing `useEffect` that fires when `contact` changes, after the messages fetch):
```typescript
if (contact) {
  fetch(`/api/lists?contactId=${contact.id}`)
    .then((r) => r.json())
    .then((d) => setContactLists(d.lists ?? []))
    .catch(() => {});
}
```

> Note: The `/api/lists` GET endpoint needs a `contactId` query param to filter lists containing a specific contact. Add this to Task 2's GET handler — see Step 2b below.

Add the Lists section in the drawer JSX, near the bottom before the closing `</div>`, after the messages section:
```typescript
{/* Lists */}
<div className="border-t border-[#e5e3df] pt-4">
  <div className="flex items-center justify-between mb-2">
    <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Lists</p>
    <div className="relative">
      <button
        ref={addListBtnRef}
        onClick={() => setShowListPopover((v) => !v)}
        className="flex items-center gap-1 text-xs text-[#5c7d9e] hover:text-[#1585ff] transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add
      </button>
      {showListPopover && contact && (
        <ListPopover
          contactIds={[contact.id]}
          onClose={() => {
            setShowListPopover(false);
            // Refresh list membership
            fetch(`/api/lists?contactId=${contact.id}`)
              .then((r) => r.json())
              .then((d) => setContactLists(d.lists ?? []));
          }}
          anchorRef={addListBtnRef as React.RefObject<HTMLElement>}
        />
      )}
    </div>
  </div>
  {contactLists.length === 0 ? (
    <p className="text-xs text-[#9b9895]">Not in any list</p>
  ) : (
    <div className="flex flex-wrap gap-1.5">
      {contactLists.map((list) => (
        <span
          key={list.id}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1585ff]/10 border border-[#1585ff]/20 text-xs text-[#1585ff]"
        >
          {list.name}
          <button
            onClick={async () => {
              await fetch(`/api/lists/${list.id}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ remove: [contact!.id] }),
              });
              setContactLists((prev) => prev.filter((l) => l.id !== list.id));
            }}
            className="hover:text-red-400 transition-colors"
          >
            <XIcon className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 2b: Update GET /api/lists to support contactId filter**

In `app/api/lists/route.ts`, update the GET handler to handle an optional `contactId` query param:

```typescript
export const GET = withTenant(async (req: NextRequest, ctx) => {
  const contactId = req.nextUrl.searchParams.get("contactId") ?? undefined;

  if (contactId) {
    // Return only lists that contain this contact
    const memberships = await prisma.contactListMember.findMany({
      where: {
        contactId,
        list: { ownerId: ctx.effectiveUserId },
      },
      include: { list: true },
    });
    const lists = memberships.map((m) => ({ id: m.list.id, name: m.list.name, memberCount: 0 }));
    return NextResponse.json({ lists });
  }

  const lists = await prisma.contactList.findMany({
    where: buildListsWhere(ctx.effectiveUserId),
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({
    lists: lists.map((l) => ({ id: l.id, name: l.name, memberCount: l._count.members, createdAt: l.createdAt })),
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/contact-drawer.tsx app/api/lists/route.ts
git commit -m "feat(ui): add Lists section to ContactDrawer"
```

---

## Task 10: Update FilterSidebar — Add Lists section + listId to Filters type

**Files:**
- Modify: `components/dashboard/filter-sidebar.tsx`

- [ ] **Step 1: Add listId to the Filters type and DEFAULT_FILTERS**

In `components/dashboard/filter-sidebar.tsx`, update the `Filters` type:

```typescript
export type Filters = {
  seniority: string[];
  function: string[];
  q: string;
  titleSearch: string[];
  industry: string[];
  companySizeBuckets: string[];
  connectedFrom: string;
  connectedTo: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
  listId?: string;
};
```

Update `DEFAULT_FILTERS`:
```typescript
export const DEFAULT_FILTERS: Filters = {
  seniority: [],
  function: [],
  q: "",
  titleSearch: [],
  industry: [],
  companySizeBuckets: [],
  connectedFrom: "",
  connectedTo: "",
  listId: undefined,
};
```

- [ ] **Step 2: Add Lists section to the sidebar**

Add to the component's imports at the top:
```typescript
import { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
```

Add state inside the component:
```typescript
const [lists, setLists] = useState<{ id: string; name: string; memberCount: number }[]>([]);

useEffect(() => {
  fetch("/api/lists")
    .then((r) => r.json())
    .then((d) => setLists(d.lists ?? []))
    .catch(() => {});
}, []);
```

Add the Lists section at the very top of the sidebar's return JSX, before the existing filter sections:
```typescript
{lists.length > 0 && (
  <div className="mb-4">
    <p className="text-[10px] font-mono font-semibold text-[#456078] uppercase tracking-widest mb-2 flex items-center gap-1.5">
      <BookMarked className="w-3 h-3" />
      Lists
    </p>
    <div className="space-y-0.5">
      {lists.map((list) => (
        <button
          key={list.id}
          onClick={() =>
            onChange({
              ...filters,
              listId: filters.listId === list.id ? undefined : list.id,
            })
          }
          className={cn(
            "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors text-left",
            filters.listId === list.id
              ? "bg-[#1585ff]/10 text-[#1585ff] font-medium"
              : "text-[#5c7d9e] hover:bg-[#1c3048] hover:text-[#9ecfff]"
          )}
        >
          <span className="truncate">{list.name}</span>
          <span className="shrink-0 text-[#456078] font-mono text-[10px]">{list.memberCount}</span>
        </button>
      ))}
    </div>
  </div>
)}
```

The `FilterSidebar` component signature already receives `filters` and `onChange` props — use them.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/filter-sidebar.tsx
git commit -m "feat(ui): add Lists filter section to FilterSidebar"
```

---

## Task 11: Update Contacts Page — Wire listId through state + URL

**Files:**
- Modify: `app/(dashboard)/contacts/page.tsx`

- [ ] **Step 1: Add listId to initial filter state from URL**

In `app/(dashboard)/contacts/page.tsx`, update the `useState` initializer for `filters` to include `listId`:

```typescript
const [filters, setFilters] = useState<Filters>(() => ({
  ...DEFAULT_FILTERS,
  q: searchParams.get("q") ?? "",
  seniority: searchParams.get("seniority")?.split(",").filter(Boolean) ?? [],
  function: searchParams.get("function")?.split(",").filter(Boolean) ?? [],
  titleSearch: searchParams.get("titleSearch")?.split(",").filter(Boolean) ?? [],
  industry: searchParams.get("industry")?.split(",").filter(Boolean) ?? [],
  companySizeBuckets: searchParams.get("companySizeBuckets")?.split(",").filter(Boolean) ?? [],
  connectedFrom: searchParams.get("connectedFrom") ?? "",
  connectedTo: searchParams.get("connectedTo") ?? "",
  hasEmail: searchParams.get("hasEmail") === "true" ? true : undefined,
  hasPhone: searchParams.get("hasPhone") === "true" ? true : undefined,
  listId: searchParams.get("listId") ?? undefined,
}));
```

- [ ] **Step 2: Add listId to buildContactsUrl**

In the `buildContactsUrl` function, add:
```typescript
if (filters.listId) params.set("listId", filters.listId);
```

- [ ] **Step 3: Add listId to URL sync effect**

In the `useEffect` that calls `router.replace`, add:
```typescript
if (filters.listId) params.set("listId", filters.listId);
```

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/contacts/page.tsx
git commit -m "feat(ui): wire listId filter through contacts page state and URL"
```

---

## Task 12: Lists Index Page

**Files:**
- Create: `app/(dashboard)/lists/page.tsx`

- [ ] **Step 1: Create the page**

Create `app/(dashboard)/lists/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookMarked, Trash2, Loader2 } from "lucide-react";

type ListSummary = { id: string; name: string; memberCount: number; createdAt: string };

export default function ListsPage() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchLists() {
    const res = await fetch("/api/lists");
    if (res.ok) {
      const data = await res.json();
      setLists(data.lists ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { fetchLists(); }, []);

  async function deleteList(id: string) {
    setDeletingId(id);
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    setLists((prev) => prev.filter((l) => l.id !== id));
    setDeletingId(null);
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#0f1e2e]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#1e3248] bg-[#162333] sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <BookMarked className="w-4 h-4 text-[#1585ff]" />
          <h1 className="text-sm font-semibold text-[#eaf2fd] tracking-tight">Lists</h1>
          {!loading && (
            <span className="text-xs font-mono text-[#456078]">{lists.length} total</span>
          )}
        </div>
      </div>

      <div className="px-5 py-5 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-[#456078] animate-spin" />
          </div>
        ) : lists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookMarked className="w-8 h-8 text-[#25405e] mb-3" />
            <p className="text-sm text-[#5c7d9e]">No lists yet</p>
            <p className="text-xs text-[#456078] mt-1">
              Select contacts on the{" "}
              <Link href="/contacts" className="text-[#1585ff] hover:underline">Contacts page</Link>{" "}
              and choose "Save to List".
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {lists.map((list) => (
              <div
                key={list.id}
                className="bg-[#162333] border border-[#1e3248] rounded-xl p-4 hover:border-[#25405e] transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/lists/${list.id}`}
                    className="flex-1 min-w-0"
                  >
                    <p className="text-sm font-medium text-[#eaf2fd] truncate group-hover:text-[#1585ff] transition-colors">
                      {list.name}
                    </p>
                    <p className="text-xs text-[#456078] mt-1 font-mono">
                      {list.memberCount} contact{list.memberCount !== 1 ? "s" : ""}
                    </p>
                    <p className="text-[10px] text-[#2a4a63] mt-2">
                      {new Date(list.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                  <button
                    onClick={() => deleteList(list.id)}
                    disabled={deletingId === list.id}
                    className="shrink-0 p-1.5 text-[#2a4a63] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete list"
                  >
                    {deletingId === list.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(dashboard)/lists/page.tsx
git commit -m "feat(ui): add /lists index page"
```

---

## Task 13: List Detail Page

**Files:**
- Create: `app/(dashboard)/lists/[id]/page.tsx`

- [ ] **Step 1: Create the page**

Create `app/(dashboard)/lists/[id]/page.tsx`:

```typescript
"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Megaphone, Pencil, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import ContactTable, { type Contact } from "@/components/dashboard/contact-table";
import { NewCampaignModal } from "@/components/dashboard/new-campaign-modal";

type ListDetail = { id: string; name: string; memberCount: number; createdAt: string };

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [list, setList] = useState<ListDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function fetchList(pg = page) {
    setLoading(true);
    const res = await fetch(`/api/lists/${id}?page=${pg}&pageSize=${pageSize}`);
    if (!res.ok) { router.push("/lists"); return; }
    const data = await res.json();
    setList(data.list);
    setContacts(data.contacts);
    setTotal(data.total);
    setLoading(false);
  }

  useEffect(() => { fetchList(); }, [id, page]);

  async function saveName() {
    if (!nameInput.trim() || !list) return;
    setSavingName(true);
    const res = await fetch(`/api/lists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setList((prev) => prev ? { ...prev, name: data.list.name } : prev);
    }
    setSavingName(false);
    setEditingName(false);
  }

  async function removeContact(contactId: string) {
    setRemovingId(contactId);
    await fetch(`/api/lists/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: [contactId] }),
    });
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    setList((prev) => prev ? { ...prev, memberCount: prev.memberCount - 1 } : prev);
    setRemovingId(null);
  }

  const totalPages = Math.ceil(total / pageSize) || 1;

  if (!list && !loading) return null;

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#0f1e2e]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#1e3248] bg-[#162333] sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/lists" className="text-[#456078] hover:text-[#5c7d9e] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                autoFocus
                className="bg-[#14223a] border border-[#1585ff]/60 rounded-md px-2 py-0.5 text-sm text-[#eaf2fd] focus:outline-none"
              />
              <button onClick={saveName} disabled={savingName} className="text-[#1585ff] hover:text-[#3090ff] transition-colors">
                {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-[#eaf2fd]">{list?.name}</h1>
              <button
                onClick={() => { setNameInput(list?.name ?? ""); setEditingName(true); }}
                className="text-[#456078] hover:text-[#5c7d9e] transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}
          {!loading && (
            <span className="text-xs font-mono text-[#456078]">{total} contacts</span>
          )}
        </div>
        <button
          onClick={() => setCampaignOpen(true)}
          disabled={total === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1585ff] border border-[#1585ff]/30 hover:bg-[#1585ff]/10 hover:border-[#1585ff]/50 rounded-md transition-all disabled:opacity-40"
        >
          <Megaphone className="w-3.5 h-3.5" />
          Launch Campaign
        </button>
      </div>

      {/* Table */}
      <div className="px-5 pt-4 pb-0 flex flex-col flex-1 min-h-0">
        <div className="flex-1 min-h-0 flex flex-col pb-4">
          <ContactTable
            contacts={contacts}
            selectedIds={new Set()}
            onToggle={() => {}}
            onSelectAll={() => {}}
            onEnrich={() => {}}
            onMessage={() => {}}
            onOpenDrawer={() => {}}
            loading={loading}
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            extraRowAction={(contact) => (
              <button
                onClick={() => removeContact(contact.id)}
                disabled={removingId === contact.id}
                className="text-[10px] text-[#456078] hover:text-red-400 transition-colors font-mono"
              >
                {removingId === contact.id ? "…" : "Remove"}
              </button>
            )}
          />
        </div>
      </div>

      <NewCampaignModal
        open={campaignOpen}
        onClose={() => setCampaignOpen(false)}
        listId={id}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add extraRowAction prop to ContactTable**

The `ContactTable` component needs an optional `extraRowAction` prop to render per-row actions. In `components/dashboard/contact-table.tsx`:

Add to the `ContactTableProps` interface:
```typescript
extraRowAction?: (contact: Contact) => React.ReactNode;
```

In the row rendering (find where each contact row is rendered), add in the last cell:
```typescript
{extraRowAction && (
  <td className="px-2 py-0 text-right">
    {extraRowAction(contact)}
  </td>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/lists/[id]/page.tsx components/dashboard/contact-table.tsx
git commit -m "feat(ui): add /lists/[id] detail page; add extraRowAction to ContactTable"
```

---

## Task 14: Update Sidebar Nav + NewCampaignModal

**Files:**
- Modify: `components/dashboard/sidebar.tsx`
- Modify: `components/dashboard/new-campaign-modal.tsx`

- [ ] **Step 1: Add Lists to sidebar nav**

In `components/dashboard/sidebar.tsx`, add `BookMarked` to the lucide import:
```typescript
import { Users, FileText, Shield, LogOut, LayoutDashboard, Wifi, Upload, BookMarked } from "lucide-react";
```

Add to `navItems` array (after the Contacts entry):
```typescript
{ href: "/lists", label: "Lists", icon: BookMarked },
```

- [ ] **Step 2: Update NewCampaignModal to accept listId**

In `components/dashboard/new-campaign-modal.tsx`, update the props interface and component signature:

```typescript
export function NewCampaignModal({
  open,
  onClose,
  contactIds,
  listId,
}: {
  open: boolean;
  onClose: () => void;
  contactIds?: string[];
  listId?: string;
}) {
```

Update the display text to handle both cases:
```typescript
<p className="mt-1 text-sm text-[#9b9895]">
  {listId
    ? "Sending to contacts in this list via LinkedIn."
    : `Sending to ${contactIds?.length ?? 0} contact${(contactIds?.length ?? 0) === 1 ? "" : "s"} via LinkedIn.`}
</p>
```

Update the `submit` function body to pass `listId`:
```typescript
body: JSON.stringify({ name, templateId, ...(listId ? { listId } : { contactIds }) }),
```

Update the submit button disabled condition:
```typescript
disabled={!name.trim() || !templateId || busy || linkedinConnected === false || (!listId && !contactIds?.length)}
```

- [ ] **Step 3: Fix TypeScript — contactIds is now optional in callers**

In `components/dashboard/bulk-enrich-bar.tsx`, the existing `NewCampaignModal` usage passes `contactIds={selectedIds}` — this still works since `contactIds` is now optional but you're providing it. No change needed.

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If there are errors, fix them before committing.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sidebar.tsx components/dashboard/new-campaign-modal.tsx
git commit -m "feat(ui): add Lists to sidebar nav; update NewCampaignModal to accept listId"
```

---

## Task 15: End-to-End Smoke Test

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all existing tests pass, new lists-api tests pass.

- [ ] **Step 2: Start the dev server and manually verify the golden path**

```bash
npm run dev
```

Open http://localhost:3001/contacts

1. Filter contacts by seniority (e.g. C-Level)
2. Select 3+ contacts using the checkboxes
3. Click "Save to List" in the bulk toolbar
4. Type a new list name → press Enter
5. Verify the popover closes and no errors appear
6. Open the sidebar → click "Lists" → verify the new list appears with correct member count
7. Click the list → verify contacts are shown
8. Click "Launch Campaign" → verify `NewCampaignModal` opens
9. Go back to Contacts → verify the list appears in the filter sidebar under "Lists"
10. Click the list in the filter sidebar → verify the contacts table narrows to that list

- [ ] **Step 3: Commit final**

```bash
git add -A
git commit -m "feat: contact lists — full implementation"
```
