# Remove LinkedIn Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all LinkedIn connection/sync/messaging infrastructure from the codebase while preserving all existing contact data.

**Architecture:** Delete LinkedIn-specific files (MCP clients, sync functions, connect routes, SSE bus), update all remaining files that imported from them, prune the Prisma schema (drop LinkedinSession, SyncJob, LINKEDIN channel), and replace the LinkedIn status card on the dashboard with a recent-import card.

**Tech Stack:** Next.js App Router, Prisma, Inngest, TypeScript

---

### Task 1: Move slug-utils out of lib/linkedin/

`slugifyCompany` is needed by the CSV import route and has no LinkedIn dependency. Move it before deleting the linkedin/ folder.

**Files:**
- Create: `lib/utils/slug-utils.ts`
- Delete: `lib/linkedin/slug-utils.ts`
- Modify: `app/api/import/csv/route.ts` (import path)
- Modify: `lib/csv/diff.ts` (import path)
- Modify: `prisma/backfill-contacts.ts` (import path)
- Modify: `prisma/seed-companies.ts` (import path)
- Move test: `tests/unit/slug-utils.test.ts` (import path)

- [ ] **Step 1: Create lib/utils/slug-utils.ts**

```ts
export function slugifyCompany(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 2: Update import in app/api/import/csv/route.ts**

Change line 6:
```ts
import { slugifyCompany } from "@/lib/utils/slug-utils";
```

- [ ] **Step 3: Update import in lib/csv/diff.ts**

```ts
import { slugifyCompany } from "@/lib/utils/slug-utils";
```

- [ ] **Step 4: Update import in prisma/backfill-contacts.ts**

```ts
import { slugifyCompany } from "../lib/utils/slug-utils";
```

- [ ] **Step 5: Update import in prisma/seed-companies.ts**

```ts
import { slugifyCompany } from "../lib/utils/slug-utils";
```

- [ ] **Step 6: Update import in tests/unit/slug-utils.test.ts**

```ts
import { slugifyCompany } from "@/lib/utils/slug-utils";
```

- [ ] **Step 7: Delete lib/linkedin/slug-utils.ts**

```bash
rm lib/linkedin/slug-utils.ts
```

- [ ] **Step 8: Commit**

```bash
git add lib/utils/slug-utils.ts lib/linkedin/slug-utils.ts app/api/import/csv/route.ts lib/csv/diff.ts prisma/backfill-contacts.ts prisma/seed-companies.ts tests/unit/slug-utils.test.ts
git commit -m "refactor: move slugifyCompany to lib/utils (out of linkedin/)"
```

---

### Task 2: Delete lib/linkedin/* remaining files and scripts

**Files:**
- Delete: `lib/linkedin/cookie-crypto.ts`
- Delete: `lib/linkedin/mcp-client.ts`
- Delete: `lib/linkedin/mcp-http-client.ts`
- Delete: `lib/linkedin/sse-bus.ts`
- Delete: `scripts/bootstrap-cookie-cache.ts`
- Delete: `tests/unit/cookie-crypto.test.ts`
- Delete: `tests/unit/mcp-client.test.ts`

- [ ] **Step 1: Delete all files**

```bash
rm lib/linkedin/cookie-crypto.ts \
   lib/linkedin/mcp-client.ts \
   lib/linkedin/mcp-http-client.ts \
   lib/linkedin/sse-bus.ts \
   scripts/bootstrap-cookie-cache.ts \
   tests/unit/cookie-crypto.test.ts \
   tests/unit/mcp-client.test.ts
```

- [ ] **Step 2: Remove now-empty linkedin directory**

```bash
rmdir lib/linkedin
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete lib/linkedin/* and related scripts/tests"
```

---

### Task 3: Delete LinkedIn Inngest functions

**Files:**
- Delete: `inngest/functions/sync-full.ts`
- Delete: `inngest/functions/sync-delta.ts`
- Delete: `inngest/functions/sync-cron.ts`
- Delete: `inngest/functions/send-message.ts`
- Delete: `inngest/functions/enrich-profiles.ts`
- Delete: `inngest/functions/profile-enrich.ts`

- [ ] **Step 1: Delete all files**

```bash
rm inngest/functions/sync-full.ts \
   inngest/functions/sync-delta.ts \
   inngest/functions/sync-cron.ts \
   inngest/functions/send-message.ts \
   inngest/functions/enrich-profiles.ts \
   inngest/functions/profile-enrich.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: delete LinkedIn sync, send, and profile-enrich Inngest functions"
```

---

### Task 4: Update app/api/inngest/route.ts

Remove the 6 deleted functions from the Inngest serve call.

**Files:**
- Modify: `app/api/inngest/route.ts`

- [ ] **Step 1: Replace the file**

```ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichContact } from "@/inngest/functions/enrich-contact";
import { enrichCompanies } from "@/inngest/functions/enrich-companies";
import { enrichCompaniesWeb } from "@/inngest/functions/enrich-companies-web";
import { campaignStart } from "@/inngest/functions/campaign-start";
import { campaignSendOne } from "@/inngest/functions/campaign-send-one";
import { campaignFinalize } from "@/inngest/functions/campaign-finalize";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [enrichContact, enrichCompanies, enrichCompaniesWeb, campaignStart, campaignSendOne, campaignFinalize],
});
```

- [ ] **Step 2: Commit**

```bash
git add app/api/inngest/route.ts
git commit -m "chore: remove deleted LinkedIn functions from Inngest serve"
```

---

### Task 5: Delete LinkedIn API routes and the connect page

**Files:**
- Delete: `app/api/linkedin/` (entire directory — 6 route files)
- Delete: `app/api/sync/trigger/route.ts`
- Delete: `app/api/sync/status/route.ts`
- Delete: `app/api/messages/send/route.ts`
- Delete: `app/(dashboard)/linkedin-connect/page.tsx`

- [ ] **Step 1: Delete all**

```bash
rm -rf app/api/linkedin
rm app/api/sync/trigger/route.ts
rm app/api/sync/status/route.ts
rm app/api/messages/send/route.ts
rm "app/(dashboard)/linkedin-connect/page.tsx"
```

- [ ] **Step 2: Remove now-empty directories**

```bash
rmdir app/api/sync 2>/dev/null || true
rmdir app/api/messages 2>/dev/null || true
rmdir "app/(dashboard)/linkedin-connect" 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete LinkedIn API routes and connect page"
```

---

### Task 6: Update campaign-send-one.ts — remove LinkedIn sending

Currently this file calls the LinkedIn MCP directly with no channel branching. Remove the LinkedIn imports and stub the actual send as unsupported until WhatsApp/Email senders are built.

**Files:**
- Modify: `inngest/functions/campaign-send-one.ts`

- [ ] **Step 1: Read the current file to understand the full structure**

Read `inngest/functions/campaign-send-one.ts` — pay attention to lines after line 60 (error handling, retry logic, finalize event).

- [ ] **Step 2: Replace the send block**

Remove the imports at the top:
```ts
// DELETE these two lines:
import { publish } from "@/lib/linkedin/sse-bus";
import { mcpSendMessage, extractUsername, extractProfileUrn } from "@/lib/linkedin/mcp-http-client";
```

Replace the `try` block that calls `mcpSendMessage` with a stub that marks the recipient FAILED:
```ts
  try {
    // TODO: implement WhatsApp / Email sending
    throw new Error(`Channel ${recipient.campaign.channel} sending not yet implemented`);
```

Keep everything else (catch block, retry logic, `campaign.finalize` event emission) exactly as-is.

- [ ] **Step 3: Commit**

```bash
git add inngest/functions/campaign-send-one.ts
git commit -m "chore: remove LinkedIn MCP sending from campaign-send-one (stub until WhatsApp/Email implemented)"
```

---

### Task 7: Update lib/tenancy/scoped-prisma.ts

Remove the `linkedinSession` include from the scoped user query — that model is being dropped from the schema.

**Files:**
- Modify: `lib/tenancy/scoped-prisma.ts`

- [ ] **Step 1: Replace lib/tenancy/scoped-prisma.ts**

Remove the `linkedinSession` and `syncJob` blocks (both models are being dropped). Also update the JSDoc:

```ts
import { prisma } from "@/lib/prisma";

/**
 * Returns a Prisma client extended with a soft org-scope guard on
 * Contact, SentMessage, and SavedView reads.
 *
 * The extension adds `ownerId` (or `senderId`) filtering automatically
 * so no query can accidentally return another tenant's rows.
 */
export function scopedPrisma(orgUserIds: string[]) {
  return prisma.$extends({
    query: {
      contact: {
        async findUnique({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async findMany({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async update({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async delete({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
      },
      sentMessage: {
        async findUnique({ args, query }) {
          args.where = { ...args.where };
          return query(args);
        },
        async findMany({ args, query }) {
          args.where = { ...args.where, senderId: { in: orgUserIds } };
          return query(args);
        },
      },
      savedView: {
        async findMany({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
      },
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/tenancy/scoped-prisma.ts
git commit -m "chore: remove linkedinSession from scoped-prisma user include"
```

---

### Task 8: Update admin API route and admin UI pages

Remove LinkedIn status from the users admin API response and the three admin UI pages that display it.

**Files:**
- Modify: `app/api/admin/users/route.ts`
- Modify: `app/(dashboard)/admin/admin-client.tsx`
- Modify: `app/(dashboard)/admin/users/page.tsx`
- Modify: `app/(dashboard)/admin/[userId]/page.tsx`

- [ ] **Step 1: Update app/api/admin/users/route.ts**

Read the file. Remove the `linkedinSession` from the Prisma `include` in the user query (around line 16). Remove the lines that build `linkedinStatus` and `lastValidatedAt` from the response (around lines 39-40). Remove those two properties from the returned user object.

- [ ] **Step 2: Update app/(dashboard)/admin/admin-client.tsx**

Read the file. Remove:
- The `LinkedinStatus` type alias
- The `linkedinStatus` and `lastValidatedAt` fields from the `UserRow` type
- The `StatusBadge` component (it only renders LinkedIn status)
- The `activeCount` variable (line 114) and its usage in the header text (line 148)
- The "LinkedIn" table header cell
- The `{/* LinkedIn status */}` table cell block (lines 293-295)
- The "Validated" table header cell and the corresponding `formatDate(u.lastValidatedAt)` cell
- The `Wifi`, `WifiOff`, `AlertCircle` imports from lucide-react (no longer used)

- [ ] **Step 3: Update app/(dashboard)/admin/users/page.tsx**

Read the file. Remove:
- `linkedinStatus` and `lastValidatedAt` from the user type
- The "LinkedIn" column header
- The `LINKEDIN_STATUS_STYLES` object and the LinkedIn status badge cell
- The "lastValidatedAt" display

- [ ] **Step 4: Update app/(dashboard)/admin/[userId]/page.tsx**

Read the file. Remove:
- `linkedinStatus` from the user type (line 13)
- The "LinkedIn Status" display block (lines 83-84)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/users/route.ts "app/(dashboard)/admin/admin-client.tsx" "app/(dashboard)/admin/users/page.tsx" "app/(dashboard)/admin/[userId]/page.tsx"
git commit -m "chore: remove LinkedIn status from admin user management"
```

---

### Task 9: Delete enrich-banner and enrichment-progress; remove from layout and contacts

Both components only listen to LinkedIn SSE events. `enrich-banner` also subscribes to `/api/sse/stream` which doesn't exist. Both are dead.

**Files:**
- Delete: `components/dashboard/enrich-banner.tsx`
- Delete: `components/dashboard/enrichment-progress.tsx`
- Modify: `app/(dashboard)/layout.tsx` (remove EnrichmentProgress)
- Modify: `app/(dashboard)/contacts/page.tsx` (remove EnrichBanner, remove sync trigger button)

- [ ] **Step 1: Delete components**

```bash
rm components/dashboard/enrich-banner.tsx
rm components/dashboard/enrichment-progress.tsx
```

- [ ] **Step 2: Update app/(dashboard)/layout.tsx**

Read the file. Remove:
```ts
import EnrichmentProgress from "@/components/dashboard/enrichment-progress";
```
and the `<EnrichmentProgress />` JSX element (line 49).

- [ ] **Step 3: Update app/(dashboard)/contacts/page.tsx**

Read the file. Remove:
- `import EnrichBanner from "@/components/dashboard/enrich-banner";`
- The `<EnrichBanner />` JSX element (line 187)
- The `syncing` / `syncDone` state variables and the `triggerSync` function
- The "Sync LinkedIn" button JSX (the `<button onClick={triggerSync} ...>` block around line 209-215)
- The `RefreshCw` lucide import if it's now unused

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete enrich-banner and enrichment-progress; remove sync trigger from contacts page"
```

---

### Task 10: Replace LinkedIn status card in the dashboard

Remove the LinkedIn connection card, sync trigger button, and related state. Replace with a "Recent Import" card showing the last CSV import stats.

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx`
- Modify: `app/(dashboard)/dashboard/dashboard-client.tsx`

- [ ] **Step 1: Update app/(dashboard)/dashboard/page.tsx**

Replace the file contents:

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const [user, contactCount, latestImport] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    prisma.contact.count({ where: { ownerId: session.user.id, removedAt: null } }),
    prisma.import.findFirst({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { fileName: true, added: true, updated: true, removed: true, createdAt: true },
    }),
  ]);

  if (!user) redirect("/sign-in");

  return (
    <DashboardClient
      user={{ name: user.name, email: user.email, image: user.image }}
      contactCount={contactCount}
      latestImport={
        latestImport
          ? {
              fileName: latestImport.fileName,
              added: latestImport.added,
              updated: latestImport.updated,
              removed: latestImport.removed,
              createdAt: latestImport.createdAt.toISOString(),
            }
          : null
      }
    />
  );
}
```

- [ ] **Step 2: Replace app/(dashboard)/dashboard/dashboard-client.tsx**

```ts
"use client";

import Link from "next/link";
import { Users, ArrowRight, Upload, FileText, Terminal } from "lucide-react";

interface Props {
  user: { name: string; email: string; image?: string | null };
  contactCount: number;
  latestImport: {
    fileName: string;
    added: number;
    updated: number;
    removed: number;
    createdAt: string;
  } | null;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DashboardClient({ user, contactCount, latestImport }: Props) {
  return (
    <div className="min-h-full bg-[#f6f5f3] p-8">
      <div className="mb-10">
        <p className="text-[#9b9895] text-sm font-mono tracking-widest uppercase mb-1">Dashboard</p>
        <h1 className="text-2xl font-semibold text-[#111110]">
          Good to see you, {user.name.split(" ")[0]}.
        </h1>
        <p className="text-[#6b6866] text-sm mt-1">{user.email}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Import card */}
        <div className="lg:col-span-2 rounded-xl border border-[#e5e3df] bg-white p-6">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
            Recent Import
          </p>
          {latestImport ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-[#1585ff]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#111110]">{latestImport.fileName}</p>
                  <p className="text-xs text-[#9b9895]">{formatRelative(latestImport.createdAt)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Added", value: latestImport.added, color: "text-emerald-600" },
                  { label: "Updated", value: latestImport.updated, color: "text-[#1585ff]" },
                  { label: "Removed", value: latestImport.removed, color: "text-amber-600" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg bg-[#f6f5f3] px-4 py-3">
                    <p className="text-xs text-[#9b9895] font-mono uppercase tracking-wide mb-1">{label}</p>
                    <p className={`text-xl font-semibold font-mono tabular-nums ${color}`}>
                      {value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-700 mb-3">
                No imports yet. Upload a CSV to add your contacts.
              </p>
              <Link
                href="/import"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#1585ff] hover:bg-[#0a70e0] text-white text-sm font-medium transition-colors"
              >
                <Upload className="w-4 h-4" />
                Import CSV
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>

        {/* Contacts card */}
        <div className="rounded-xl border border-[#e5e3df] bg-white p-6 flex flex-col">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
            Your Contacts
          </p>
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-5xl font-semibold text-[#111110] font-mono tabular-nums">
              {contactCount.toLocaleString()}
            </p>
            <p className="text-xs text-[#9b9895] mt-2">contacts imported</p>
          </div>
          <Link
            href="/contacts"
            className="mt-5 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-[#e5e3df] hover:border-blue-200 hover:bg-[#eff5ff] text-sm text-[#6b6866] hover:text-[#1585ff] transition-all group"
          >
            <Users className="w-4 h-4" />
            View Contacts
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-3 rounded-xl border border-[#e5e3df] bg-white p-6">
          <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-4">
            Quick Actions
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { href: "/contacts", label: "Browse Contacts", icon: Users },
              { href: "/contacts?seniority=C_LEVEL", label: "C-Level contacts", icon: Users },
              { href: "/import", label: "Import CSV", icon: Upload },
              { href: "/templates", label: "Message templates", icon: Terminal },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-[#e5e3df] hover:border-blue-200 hover:bg-[#eff5ff] text-sm text-[#6b6866] hover:text-[#1585ff] transition-all group"
              >
                <Icon className="w-4 h-4 shrink-0 text-[#9b9895] group-hover:text-[#1585ff] transition-colors" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/dashboard/page.tsx" "app/(dashboard)/dashboard/dashboard-client.tsx"
git commit -m "feat: replace LinkedIn status card with recent import stats on dashboard"
```

---

### Task 11: Remove LinkedIn nav item from sidebar

The sidebar was already updated to remove the LinkedIn nav item. Verify it's gone and remove the now-unused `Wifi` import.

**Files:**
- Modify: `components/dashboard/sidebar.tsx`

- [ ] **Step 1: Read the current sidebar**

Read `components/dashboard/sidebar.tsx`. Confirm:
- The `{ href: "/linkedin-connect", label: "LinkedIn", icon: Wifi }` entry is absent from `navItems`
- The `Wifi` import from lucide-react is absent (it was used only for that nav item)

- [ ] **Step 2: Remove Wifi from import if still present**

If `Wifi` is still in the lucide import line, remove it.

- [ ] **Step 3: Commit if any changes were needed**

```bash
git add components/dashboard/sidebar.tsx
git commit -m "chore: remove Wifi import from sidebar (LinkedIn nav item already removed)"
```

---

### Task 12: Update Prisma schema and run migration

Drop `LinkedinSession`, `SyncJob`, `SessionStatus`, `SyncType`, remove `LINKEDIN` from `CampaignChannel`, remove `Contact.connectedAt`, remove `linkedinSession` relation from `User`.

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Edit prisma/schema.prisma**

Make these changes:

**Remove entire `LinkedinSession` model** (lines 147-158):
```
// DELETE:
model LinkedinSession {
  ...
}
```

**Remove `SessionStatus` enum** (lines 21-25):
```
// DELETE:
enum SessionStatus {
  ACTIVE
  EXPIRED
  DISCONNECTED
}
```

**Remove entire `SyncJob` model** (lines 240-255):
```
// DELETE:
model SyncJob {
  ...
}
```

**Remove `SyncType` enum** (lines 45-49):
```
// DELETE:
enum SyncType {
  FULL
  DELTA
  ENRICH
}
```

**Remove `LINKEDIN` from CampaignChannel enum**:
```prisma
enum CampaignChannel {
  EMAIL
  WHATSAPP
}
```

**Remove from User model**:
```
// DELETE this relation line:
linkedinSession LinkedinSession?
// DELETE this relation line:
syncJobs        SyncJob[]
```

**Remove from Contact model**:
```
// DELETE:
connectedAt      DateTime?
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name remove-linkedin-connections
```

Expected: Prisma generates and applies a migration that drops the `LinkedinSession` and `SyncJob` tables, drops `SessionStatus` and `SyncType` enums, removes the `LINKEDIN` enum value from `CampaignChannel`, and drops the `connectedAt` column from `Contact`.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): remove LinkedinSession, SyncJob, LINKEDIN channel; drop connectedAt"
```

---

### Task 13: TypeScript check and fix any remaining import errors

After all deletions and schema changes, verify the project compiles cleanly.

**Files:** Any that still import from deleted paths.

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -60
```

- [ ] **Step 2: Fix any errors**

Common errors to expect:
- Any file still importing from `lib/linkedin/*` — update or remove the import
- Any file referencing `linkedinSession`, `syncJobs`, `SyncJob`, `LinkedinSession`, `connectedAt` — remove those references
- Any file referencing `CampaignChannel.LINKEDIN` — remove that branch
- Any test file referencing deleted types — update or delete the test

- [ ] **Step 3: Re-run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

Expected: All tests pass. Tests for deleted functionality (cookie-crypto, mcp-client) are already gone.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve TypeScript errors after LinkedIn removal"
```
