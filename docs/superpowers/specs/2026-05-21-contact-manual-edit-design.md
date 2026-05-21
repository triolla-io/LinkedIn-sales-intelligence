# Contact Manual Edit

**Date:** 2026-05-21

## Summary

Allow users to manually set contact fields (email, phone, title, company, location, headline) from the contact drawer. Manual edits are sticky — enrichment will not overwrite fields the user has explicitly set.

## Data Model

Add one column to the `Contact` model:

```prisma
manualFields  String[]  @default([])
```

This stores the names of fields the user has manually edited (e.g. `["email", "phone"]`). When a field name appears in this list, enrichment skips it. No separate table or join required.

## API

**New endpoint:** `PATCH /api/contacts/[id]`

Accepts any subset of the editable fields:

```ts
{
  email?: string | null
  phone?: string | null
  currentTitle?: string | null
  currentCompany?: string | null
  location?: string | null
  headline?: string | null
}
```

Handler behavior:
1. Verify the authenticated user owns the contact (`ownerId` check via `withTenant`)
2. Write only the fields present in the request body
3. Append those field names to `manualFields` (union — no duplicates)

The existing `GET /api/contacts/[id]` is unchanged.

## UI

### Edit button

A small "Edit" text button appears to the right of the "Contact Details" section label in the contact drawer (`contact-drawer.tsx`). This matches the existing pattern used for the "Add" button in the Lists section.

### Edit modal

A new `EditContactModal` component renders as a dialog over the drawer. It:

- Pre-populates all 6 fields from the current contact values
- Shows a Save button and a Cancel button
- On Save: fires `PATCH /api/contacts/[id]`, closes on success, calls `onSaved(updatedContact)` to update local state in the drawer
- Fields with manually-set values may optionally display a small indicator (e.g. a dot or "manual" badge) so the user knows the field is protected from enrichment

The drawer owns open/close state (`showEditModal`) and passes `contact` + `onSaved` into the modal.

## Enrichment Integration

In the enrichment write path (Inngest job that calls `prisma.contact.update` after Apollo response), build the update payload by filtering out any field whose name appears in `contact.manualFields`.

Example:

```ts
const contact = await prisma.contact.findFirst({ where: { id } });
const protected = new Set(contact.manualFields);

const patch: Partial<Contact> = {};
if (!protected.has("email") && apolloEmail) patch.email = apolloEmail;
if (!protected.has("phone") && apolloPhone) patch.phone = apolloPhone;
// ... etc
```

This applies to both single-contact enrich (`/api/contacts/[id]/enrich`) and bulk enrich (`/api/contacts/bulk-enrich`, list enrich).

## Out of Scope

- Audit log of manual edits
- Per-field "revert to enriched value" action
- Allowing users to un-protect a field (remove it from `manualFields`)
