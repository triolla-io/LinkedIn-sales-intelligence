# Contact Lists — Design Spec

**Date:** 2026-05-20  
**Status:** Approved

## Goal

Allow users to curate named lists of contacts, use them as campaign audiences (email / WhatsApp), and access them from both the contacts page and a dedicated Lists page.

Primary workflow:
1. Filter contacts (e.g. seniority = C-Level / CTO)
2. Bulk-select → "Save to list" → name it (e.g. "Q3 CTO Campaign")
3. Open the list → "Launch Campaign" → send via email or WhatsApp

---

## Data Layer

Two new Prisma models added to `prisma/schema.prisma`:

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

Back-relations to add:
- `Contact` → `lists ContactListMember[]`
- `User` → `contactLists ContactList[]`

Lists are personal (scoped to `ownerId`). Contacts can belong to multiple lists. Deleting a list or contact cascades membership rows.

---

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/lists` | All lists for current user (id, name, member count) |
| `POST` | `/api/lists` | Create list — body: `{ name: string, contactIds?: string[] }` |
| `GET` | `/api/lists/[id]` | List detail with paginated members |
| `DELETE` | `/api/lists/[id]` | Delete list |
| `PATCH` | `/api/lists/[id]` | Rename list — body: `{ name: string }` |
| `POST` | `/api/lists/[id]/members` | Add/remove contacts — body: `{ add?: string[], remove?: string[] }` |

**Contacts API change:** `/api/contacts` accepts a new optional `listId` query param. When present, the query adds a `WHERE contactId IN (SELECT contactId FROM ContactListMember WHERE listId = ?)` clause. All other filters still apply on top.

---

## UI

### 1. Bulk-select toolbar (`BulkEnrichBar`)
- New "Save to List" button (icon: `Bookmark`) added alongside Enrich / Campaign / Export.
- Clicking opens a popover anchored to the button:
  - Existing lists shown as checkboxes (checked = contact is already a member of that list for single-contact selection; indeterminate for partial bulk selection)
  - "New list…" text input at the bottom — typing and pressing Enter creates the list and adds selected contacts immediately
- On save: calls `POST /api/lists/[id]/members` for existing lists, or `POST /api/lists` with `contactIds` for a new one.

### 2. Contact drawer (`ContactDrawer`)
- New "Lists" section at the bottom of the drawer.
- Shows chips for each list the contact belongs to (with × to remove).
- "+ Add to list" button opens the same popover as above (single-contact mode).

### 3. Filter sidebar (`FilterSidebar`)
- New "Lists" section at the very top, above existing filters.
- Renders all user lists as clickable items showing name + member count.
- Clicking a list sets `listId` in the filter state; the contacts table narrows to that list's members. Only one list can be active at a time (clicking another replaces it; clicking again deselects).
- "Lists" section collapses if user has no lists.

### 4. `/lists` page (new)
- Added to sidebar nav: label "Lists", icon `BookMarked`, href `/lists`.
- **Index view:** card grid or table of all user lists — name, member count, created date, delete button.
- **Detail view** (`/lists/[id]`): 
  - Header: list name (editable inline), member count, "Launch Campaign" button.
  - Body: reuses `ContactTable` component, contacts filtered to list members only, with an extra "Remove" action per row.
  - "Launch Campaign" opens `NewCampaignModal` pre-populated with the list's contact IDs.

### 5. `NewCampaignModal` update
- Accepts `listId?: string` in addition to `contactIds`.
- When `listId` is provided, the modal resolves members at launch time (server-side) rather than passing a potentially-stale array.

---

## Error Handling

- Creating a list with a duplicate name: allowed (names are not unique-constrained). Users can have two lists with the same name.
- Adding a contact that's already in the list: `POST /api/lists/[id]/members` is idempotent — Prisma upsert on the composite PK.
- Deleting a contact (via LinkedIn sync `removedAt`): `ContactListMember` rows cascade-delete automatically.
- Empty list: valid — a list with 0 members can exist and be edited.

---

## Out of Scope

- Shared / org-level lists
- List-to-list operations (merge, intersect)
- Automatic list population via filter rules (dynamic lists)
