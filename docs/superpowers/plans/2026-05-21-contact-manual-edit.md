# Contact Manual Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users manually edit a contact's email, phone, title, company, location, and headline from the contact drawer, with manual edits protected from Apollo enrichment overwriting them.

**Architecture:** A `manualFields String[]` column on `Contact` tracks which fields the user has set. A new `PATCH /api/contacts/[id]` endpoint writes edits and updates that list. The Inngest `enrich-contact` job reads `manualFields` before writing Apollo results and skips protected fields. A new `EditContactModal` component is wired into the existing contact drawer.

**Tech Stack:** Next.js App Router, Prisma (PostgreSQL), Inngest, React, Tailwind CSS, Vitest

---

### Task 1: Schema migration — add `manualFields` to Contact

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the field to the Contact model**

In `prisma/schema.prisma`, find the `model Contact` block. After the `enrichmentSource String?` line, add:

```prisma
manualFields     String[]  @default([])
```

The block around it should look like:

```prisma
  // enrichment
  email            String?
  phone            String?
  enrichedAt       DateTime?
  enrichmentSource String?
  manualFields     String[]  @default([])
```

- [ ] **Step 2: Generate and apply the migration**

```bash
npx prisma migrate dev --name add-contact-manual-fields
```

Expected: migration created and applied, Prisma client regenerated.

- [ ] **Step 3: Verify Prisma client has the new field**

```bash
grep -r "manualFields" lib/generated/prisma/
```

Expected: output includes `manualFields` in the generated types.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add manualFields to Contact schema"
```

---

### Task 2: PATCH API — write contact edits and update manualFields

**Files:**
- Modify: `app/api/contacts/[id]/route.ts`
- Create: `tests/unit/contacts-patch-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/contacts-patch-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";

const EDITABLE_FIELDS = ["email", "phone", "currentTitle", "currentCompany", "location", "headline"] as const;
type EditableField = typeof EDITABLE_FIELDS[number];

function parseEditBody(body: unknown): Partial<Record<EditableField, string | null>> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const patch: Partial<Record<EditableField, string | null>> = {};
  let hasField = false;
  for (const key of EDITABLE_FIELDS) {
    if (key in b) {
      const val = b[key];
      if (val !== null && typeof val !== "string") return null;
      patch[key] = val as string | null;
      hasField = true;
    }
  }
  return hasField ? patch : null;
}

function mergeManualFields(existing: string[], added: string[]): string[] {
  return Array.from(new Set([...existing, ...added]));
}

describe("parseEditBody", () => {
  it("accepts email only", () => {
    expect(parseEditBody({ email: "a@b.com" })).toEqual({ email: "a@b.com" });
  });
  it("accepts multiple fields", () => {
    expect(parseEditBody({ email: "a@b.com", phone: "123" })).toEqual({ email: "a@b.com", phone: "123" });
  });
  it("accepts null to clear a field", () => {
    expect(parseEditBody({ email: null })).toEqual({ email: null });
  });
  it("rejects unknown fields only (no known fields present)", () => {
    expect(parseEditBody({ unknownField: "x" })).toBeNull();
  });
  it("rejects non-string non-null value", () => {
    expect(parseEditBody({ email: 123 })).toBeNull();
  });
  it("rejects empty body", () => {
    expect(parseEditBody({})).toBeNull();
  });
  it("rejects non-object", () => {
    expect(parseEditBody(null)).toBeNull();
  });
});

describe("mergeManualFields", () => {
  it("unions existing and new", () => {
    expect(mergeManualFields(["email"], ["phone"])).toEqual(["email", "phone"]);
  });
  it("no duplicates", () => {
    expect(mergeManualFields(["email", "phone"], ["email"])).toEqual(["email", "phone"]);
  });
  it("works from empty", () => {
    expect(mergeManualFields([], ["email"])).toEqual(["email"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/contacts-patch-api.test.ts
```

Expected: FAIL — `parseEditBody` and `mergeManualFields` are not defined.

- [ ] **Step 3: Add the PATCH handler to the existing route file**

Open `app/api/contacts/[id]/route.ts`. The file currently only has a `GET` handler. Add the PATCH handler below it:

```ts
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const id = _req.nextUrl.pathname.split("/").at(-1)!;

  const contact = await prisma.contact.findFirst({
    where: { id, ownerId: ctx.effectiveUserId, removedAt: null },
    include: {
      messages: {
        orderBy: { sentAt: "desc" },
        take: 20,
        select: { id: true, body: true, sentAt: true, status: true },
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(contact);
});

const EDITABLE_FIELDS = ["email", "phone", "currentTitle", "currentCompany", "location", "headline"] as const;
type EditableField = typeof EDITABLE_FIELDS[number];

function parseEditBody(body: unknown): Partial<Record<EditableField, string | null>> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const patch: Partial<Record<EditableField, string | null>> = {};
  let hasField = false;
  for (const key of EDITABLE_FIELDS) {
    if (key in b) {
      const val = b[key];
      if (val !== null && typeof val !== "string") return null;
      patch[key] = val as string | null;
      hasField = true;
    }
  }
  return hasField ? patch : null;
}

function mergeManualFields(existing: string[], added: string[]): string[] {
  return Array.from(new Set([...existing, ...added]));
}

export const PATCH = withTenant(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;

  const contact = await prisma.contact.findFirst({
    where: { id, ownerId: ctx.effectiveUserId, removedAt: null },
    select: { id: true, manualFields: true },
  });
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const patch = parseEditBody(body);
  if (!patch) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updatedManualFields = mergeManualFields(contact.manualFields, Object.keys(patch));

  const updated = await prisma.contact.update({
    where: { id },
    data: { ...patch, manualFields: updatedManualFields },
  });

  return NextResponse.json(updated);
});
```

- [ ] **Step 4: Update the test to import helpers from route (copy inline for isolation)**

The test already has the helpers inlined (same pattern used in `lists-api.test.ts`) — no change needed.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/unit/contacts-patch-api.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/contacts/\[id\]/route.ts tests/unit/contacts-patch-api.test.ts
git commit -m "feat: add PATCH /api/contacts/[id] for manual field edits"
```

---

### Task 3: Enrichment — respect manualFields when saving Apollo results

**Files:**
- Modify: `inngest/functions/enrich-contact.ts`
- Create: `tests/unit/enrich-manual-fields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/enrich-manual-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";

function buildEnrichPatch(
  result: { email?: string | null; phone?: string | null; companySize?: number | null; currentCompany?: string | null; industry?: string | null },
  contact: { currentCompany?: string | null; industry?: string | null; manualFields: string[] }
): Record<string, unknown> {
  const protected_ = new Set(contact.manualFields);
  const patch: Record<string, unknown> = {};
  if (!protected_.has("email") && result.email) patch.email = result.email;
  if (!protected_.has("phone") && result.phone) patch.phone = result.phone;
  if (result.companySize) patch.companySize = result.companySize;
  if (!protected_.has("currentCompany") && result.currentCompany && !contact.currentCompany)
    patch.currentCompany = result.currentCompany;
  if (!protected_.has("industry") && result.industry && !contact.industry)
    patch.industry = result.industry;
  patch.enrichedAt = "SET";
  patch.enrichmentSource = "apollo";
  return patch;
}

describe("buildEnrichPatch", () => {
  it("applies all fields when manualFields is empty", () => {
    const patch = buildEnrichPatch(
      { email: "a@b.com", phone: "123", companySize: 50 },
      { manualFields: [] }
    );
    expect(patch.email).toBe("a@b.com");
    expect(patch.phone).toBe("123");
    expect(patch.companySize).toBe(50);
  });

  it("skips email when it is in manualFields", () => {
    const patch = buildEnrichPatch(
      { email: "apollo@b.com", phone: "123" },
      { manualFields: ["email"] }
    );
    expect(patch.email).toBeUndefined();
    expect(patch.phone).toBe("123");
  });

  it("skips phone when it is in manualFields", () => {
    const patch = buildEnrichPatch(
      { email: "a@b.com", phone: "apollo-phone" },
      { manualFields: ["phone"] }
    );
    expect(patch.phone).toBeUndefined();
    expect(patch.email).toBe("a@b.com");
  });

  it("skips currentCompany when it is in manualFields", () => {
    const patch = buildEnrichPatch(
      { currentCompany: "Apollo Corp" },
      { currentCompany: null, manualFields: ["currentCompany"] }
    );
    expect(patch.currentCompany).toBeUndefined();
  });

  it("always sets enrichedAt and enrichmentSource", () => {
    const patch = buildEnrichPatch({}, { manualFields: [] });
    expect(patch.enrichedAt).toBe("SET");
    expect(patch.enrichmentSource).toBe("apollo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/enrich-manual-fields.test.ts
```

Expected: FAIL — `buildEnrichPatch` is not defined.

- [ ] **Step 3: Update enrich-contact.ts to respect manualFields**

Replace the `save-results` step in `inngest/functions/enrich-contact.ts`. The `load-and-check` step must also select `manualFields`. Full updated file:

```ts
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchPerson } from "@/lib/apollo/client";

export const enrichContact = inngest.createFunction(
  { id: "enrich-contact", triggers: [{ event: "enrich.contact" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { contactId } = event.data as { contactId: string; actorId: string };

    const { contact, orgId, month } = await step.run("load-and-check", async () => {
      const c = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { owner: { include: { org: true } } },
      });
      if (!c) throw new Error(`Contact ${contactId} not found`);

      const orgId = c.owner.orgId;
      const month = new Date().toISOString().slice(0, 7);
      const spend = await prisma.enrichmentSpend.findUnique({
        where: { orgId_month: { orgId, month } },
      });
      const credits = spend?.credits ?? 0;
      if (credits >= c.owner.org.monthlyApolloBudget) {
        throw new Error("BUDGET_EXHAUSTED");
      }

      return { contact: c, orgId, month };
    });

    const result = await step.run("match-person", async () => {
      return matchPerson({
        name: contact.fullName,
        company: contact.currentCompany ?? undefined,
        linkedinUrl: contact.linkedinUrl ?? undefined,
      });
    });

    await step.run("save-results", async () => {
      const { email, phone, companySize, currentCompany, industry } = result;
      const protected_ = new Set(contact.manualFields as string[]);

      const patch: Record<string, unknown> = {};
      if (!protected_.has("email") && email) patch.email = email;
      if (!protected_.has("phone") && phone) patch.phone = phone;
      if (companySize) patch.companySize = companySize;
      if (!protected_.has("currentCompany") && currentCompany && !contact.currentCompany)
        patch.currentCompany = currentCompany;
      if (!protected_.has("industry") && industry && !contact.industry)
        patch.industry = industry;
      patch.enrichedAt = new Date();
      patch.enrichmentSource = "apollo";

      await prisma.$transaction([
        prisma.contact.update({ where: { id: contactId }, data: patch }),
        prisma.enrichmentSpend.upsert({
          where: { orgId_month: { orgId, month } },
          create: { orgId, month, credits: 1 },
          update: { credits: { increment: 1 } },
        }),
      ]);
    });

    const { email, phone, companySize } = result;
    return { contactId, email, phone, companySize };
  }
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/enrich-manual-fields.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add inngest/functions/enrich-contact.ts tests/unit/enrich-manual-fields.test.ts
git commit -m "feat: skip manualFields when writing Apollo enrichment results"
```

---

### Task 4: Update Contact type and drawer state

**Files:**
- Modify: `components/dashboard/contact-table.tsx` (Contact type)
- Modify: `components/dashboard/contact-drawer.tsx` (edit modal state + Edit button)

- [ ] **Step 1: Add manualFields to the Contact type**

In `components/dashboard/contact-table.tsx`, update the `Contact` type to include `manualFields`:

```ts
export type Contact = {
  id: string;
  fullName: string;
  headline?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  companySize?: number | null;
  company?: { staffCount: number | null; industry: string | null } | null;
  seniority?: string | null;
  function?: string | null;
  location?: string | null;
  industry?: string | null;
  email?: string | null;
  phone?: string | null;
  lastSyncedAt: string;
  linkedinUrl: string;
  manualFields?: string[];
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/contact-table.tsx
git commit -m "feat: add manualFields to Contact type"
```

---

### Task 5: Build EditContactModal component

**Files:**
- Create: `components/dashboard/edit-contact-modal.tsx`

- [ ] **Step 1: Create the component**

Create `components/dashboard/edit-contact-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";

interface EditContactModalProps {
  contact: Contact;
  onClose: () => void;
  onSaved: (updated: Contact) => void;
}

const FIELDS: { key: keyof Contact; label: string; type?: string }[] = [
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "currentTitle", label: "Title" },
  { key: "currentCompany", label: "Company" },
  { key: "location", label: "Location" },
  { key: "headline", label: "Headline" },
];

export default function EditContactModal({ contact, onClose, onSaved }: EditContactModalProps) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const { key } of FIELDS) {
      initial[key] = (contact[key] as string | null | undefined) ?? "";
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manualSet = new Set(contact.manualFields ?? []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | null> = {};
      for (const { key } of FIELDS) {
        body[key] = form[key] || null;
      }
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = await res.json();
      onSaved({ ...contact, ...updated });
      onClose();
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-xl shadow-2xl border border-[#e5e3df]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e3df]">
          <h3 className="text-sm font-semibold text-[#111110]">Edit Contact</h3>
          <button onClick={onClose} className="text-[#9b9895] hover:text-[#6b6866] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {FIELDS.map(({ key, label, type }) => (
            <div key={key}>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                  {label}
                </label>
                {manualSet.has(key) && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
                    manual
                  </span>
                )}
              </div>
              <input
                type={type ?? "text"}
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#d1cfcb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] text-[#111110] placeholder:text-[#c4c2be]"
                placeholder={`Add ${label.toLowerCase()}...`}
              />
            </div>
          ))}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#e5e3df]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "px-4 py-2 text-sm font-medium text-white bg-[#1585ff] rounded-lg transition-colors",
              saving ? "opacity-60 cursor-not-allowed" : "hover:bg-[#0a70e0]"
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/edit-contact-modal.tsx
git commit -m "feat: add EditContactModal component"
```

---

### Task 6: Wire Edit button into ContactDrawer

**Files:**
- Modify: `components/dashboard/contact-drawer.tsx`

- [ ] **Step 1: Add import and state**

At the top of `components/dashboard/contact-drawer.tsx`, add the import:

```ts
import EditContactModal from "./edit-contact-modal";
```

Inside the `ContactDrawer` component, add state for the modal and a way to update the local contact:

```ts
const [showEdit, setShowEdit] = useState(false);
const [localContact, setLocalContact] = useState<Contact | null>(contact);
```

Add a `useEffect` to sync `localContact` when the `contact` prop changes (i.e. when a different contact is opened):

```ts
useEffect(() => {
  setLocalContact(contact);
  setShowEdit(false);
}, [contact?.id]);
```

Replace all uses of `contact` inside the drawer panel body with `localContact` (the `contact` prop is still used for visibility checks — only the rendered fields should use `localContact`).

- [ ] **Step 2: Add the Edit button next to the "Contact Details" label**

Find the "Contact Details" section header in the drawer body (around line 145). Change it from:

```tsx
<p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
  Contact Details
</p>
```

to:

```tsx
<div className="flex items-center justify-between">
  <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
    Contact Details
  </p>
  <button
    onClick={() => setShowEdit(true)}
    className="text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
  >
    Edit
  </button>
</div>
```

- [ ] **Step 3: Render the modal**

At the bottom of the drawer JSX (just before the closing `</>` of the panel content), add:

```tsx
{showEdit && localContact && (
  <EditContactModal
    contact={localContact}
    onClose={() => setShowEdit(false)}
    onSaved={(updated) => {
      setLocalContact(updated);
      setShowEdit(false);
    }}
  />
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/contact-drawer.tsx
git commit -m "feat: wire EditContactModal into contact drawer"
```

---

### Task 7: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open a contact drawer and click Edit**

Navigate to the Contacts page, click any row to open the drawer. Confirm the "Edit" button appears next to the "Contact Details" label.

- [ ] **Step 3: Edit email and save**

Click Edit. Change the email field. Click Save. Confirm:
- The drawer now shows the new email
- The field shows a "manual" badge when you reopen Edit

- [ ] **Step 4: Verify manualFields in DB**

```bash
npx prisma studio
```

Open the Contact record. Confirm `manualFields` contains `["email"]`.

- [ ] **Step 5: Re-enrich the contact**

Click the Enrich button on the contact. Confirm the email is NOT overwritten by Apollo.
