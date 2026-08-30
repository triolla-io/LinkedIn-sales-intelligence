import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { dispatchPostScrapes } from "@/lib/post-comments/dispatch";

/**
 * People picker for the post-comments module: who to watch for new posts.
 *
 * `marked` = contacts currently watched (postWatchEnabled: true); `matches` = search
 * results eligible to be added. Deliberately NOT gated behind postCommentsEnabled —
 * choosing who to watch is what a rep does before turning the module on, same reasoning
 * as tech-radar's marks route (app/api/tech-radar/marks/route.ts). The org gate is
 * enforced downstream: dispatchPostScrapes only creates a scrape task when the owning
 * org has postCommentsEnabled, so following someone while the module is off records the
 * watch but queues nothing until it's turned on.
 */

const SEARCH_LIMIT = 15;

const PERSON_SELECT = {
  id: true,
  fullName: true,
  currentTitle: true,
  currentCompany: true,
  linkedinUrl: true,
} as const;

export const GET = withTenant(async (req: NextRequest, ctx) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  const marked = await prisma.contact.findMany({
    where: { ownerId: ctx.effectiveUserId, removedAt: null, postWatchEnabled: true },
    select: PERSON_SELECT,
    orderBy: { postWatchAddedAt: "desc" },
  });

  const matches = q
    ? await prisma.contact.findMany({
        where: {
          ownerId: ctx.effectiveUserId,
          removedAt: null,
          linkedinUrl: { not: "" },
          // Two independent OR groups, nested under an explicit AND so neither
          // overwrites the other (a second top-level `OR` key would clobber the first).
          AND: [
            // Prisma's `NOT` excludes NULLs here: measured against the dev DB, `NOT:
            // { postWatchEnabled: true }` matched 0 of 16,250 contacts while this OR form
            // matched all 16,250. postWatchEnabled is Boolean? with no default, so every
            // never-toggled contact is null — it MUST be included or the picker is empty
            // forever. Do not "simplify" this back to NOT.
            { OR: [{ postWatchEnabled: false }, { postWatchEnabled: null }] },
            // "Who do I know at company X" is as natural an entry point as a name, and
            // currentTitle/currentCompany are already fetched + shown on each result row.
            {
              OR: [
                { fullName: { contains: q, mode: "insensitive" } },
                { currentTitle: { contains: q, mode: "insensitive" } },
                { currentCompany: { contains: q, mode: "insensitive" } },
              ],
            },
          ],
        },
        select: PERSON_SELECT,
        orderBy: { fullName: "asc" },
        take: SEARCH_LIMIT,
      })
    : [];

  return NextResponse.json({ marked, matches });
});

type Body = { contactId?: unknown; value?: unknown };

/**
 * Toggle one contact's post-watch. `value: true` follows and, so the first drafts show up
 * today rather than at tomorrow's 08:00 tick, immediately dispatches a scrape for just
 * this contact — updateMany's owner-scoped WHERE above is what guarantees that contact
 * belongs to this user before dispatchPostScrapes ever sees the id.
 */
export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const body = (await req.json()) as Body;
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId || typeof body.value !== "boolean") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const updated = await prisma.contact.updateMany({
    // linkedinUrl: { not: "" } — a contact with no LinkedIn URL can never be scraped
    // (dispatchPostScrapes filters it out), so watching one via the API would silently
    // create a chip that does nothing forever. Reject it the same way a foreign or
    // removed contact is rejected: count 0 -> 404.
    where: { id: contactId, ownerId: ctx.effectiveUserId, removedAt: null, linkedinUrl: { not: "" } },
    data: {
      postWatchEnabled: body.value,
      postWatchAddedAt: body.value ? new Date() : null,
    },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (body.value) {
    await dispatchPostScrapes({ contactIds: [contactId] });
  }

  return NextResponse.json({ ok: true });
});
