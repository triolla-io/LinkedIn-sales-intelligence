import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { normalizeAxisKey } from "@/lib/tech-radar/axis";

/**
 * Manual person tags — the half of the correction that ADDS.
 *
 * The person model is built by an LLM and is sometimes wrong. Until this route the only
 * correction a human had was muting an axis (`mutedAt`): they could subtract, never add.
 * A manual tag is the other direction — "he always cares about cyber regulation" as a
 * one-line fix on the person page.
 *
 * What makes it worth typing is that a rebuild does not eat it: `PersonAxis.source`
 * `"MANUAL"` is the marker the rebuild's supersession excludes, so a MANUAL link is the
 * one kind of link the machine may never quietly replace. That is the whole contract of
 * this file, and it lives in exactly one field.
 *
 * DELETE mutes, it does not delete — the same semantics as the sibling route's muteAxis.
 * A deleted axis takes its reason with it, and a correction nobody can see is one nobody
 * can undo.
 */

/**
 * One segment deeper than the sibling person route: …/people/<contactId>/tags, so the id
 * is the second-from-last segment. `.at(-1)` here would be the literal "tags".
 *
 * (Read off the path rather than from a params argument on purpose: `withTenant` wraps
 * `(req: NextRequest) => Promise<Response>` and passes no route-params argument, so every
 * dynamic radar route resolves its own id this way.)
 */
function contactIdFromTagsPath(req: NextRequest): string {
  return req.nextUrl.pathname.split("/").at(-2)!;
}

/** The person's own axis bag, scoped exactly as the sibling route's loadPerson scopes it. */
async function loadProfile(req: NextRequest, ownerId: string) {
  return prisma.contact.findFirst({
    where: { id: contactIdFromTagsPath(req), ownerId, removedAt: null },
    select: { id: true, personProfile: { select: { id: true } } },
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; aliases?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((a: unknown): a is string => typeof a === "string" && a.trim().length > 0)
    : [];
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  // An all-filler name normalises to nothing, and `entity:<profile>:` with no suffix is a
  // real key — every such tag, however different its text, would collide onto one
  // degenerate axis. Same guard ensureIndustryAxis puts on `industry:`.
  const normalized = normalizeAxisKey(name);
  if (!normalized) return NextResponse.json({ error: "name_not_distinctive" }, { status: 400 });

  const contact = await loadProfile(req, ctx.effectiveUserId);
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!contact.personProfile) {
    return NextResponse.json({ error: "no_person_profile" }, { status: 404 });
  }
  const personProfileId = contact.personProfile.id;

  // Keyed per person, not per org: a PERSON_ENTITY axis is a net for ONE person, so two
  // people watching "One Zero" get their own rows rather than a shared subject.
  const key = `entity:${personProfileId}:${normalized}`;

  // upsert, not findUnique-then-create: RadarAxis is unique on [orgId, key] and a lost
  // race would throw P2002 — the atomic form has no such window (same reasoning as
  // ensureIndustryAxis).
  const axis = await prisma.radarAxis.upsert({
    where: { orgId_key: { orgId: ctx.org.id, key } },
    create: {
      orgId: ctx.org.id,
      key,
      // The label is what the human typed. Only the key is normalised — the person page
      // shows this string back to them, and it has to read the way they wrote it.
      label: name,
      kind: "PERSON_ENTITY",
      // Matched in code by name + aliases, not by a search query of its own.
      searchQueries: [],
    },
    update: {},
    select: { id: true },
  });

  const existing = await prisma.personAxis.findFirst({
    where: { personProfileId, axisId: axis.id },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ error: "already_exists" }, { status: 409 });

  try {
    const link = await prisma.personAxis.create({
      data: {
        personProfileId,
        axisId: axis.id,
        weight: 1,
        agenda: false,
        rationale: "נוסף ידנית",
        source: "MANUAL",
        evidence: { aliases, tagKind: "manual" },
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, axisId: axis.id, personAxisId: link.id });
  } catch (err) {
    // Two clicks on the same tag land on [personProfileId, axisId]; the loser is a
    // duplicate, not a server error.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "already_exists" }, { status: 409 });
    }
    throw err;
  }
});

export const DELETE = withTenant(async (req: NextRequest, ctx) => {
  const body = (await req.json().catch(() => ({}))) as { axisId?: unknown };
  const axisId = typeof body.axisId === "string" ? body.axisId.trim() : "";
  if (!axisId) return NextResponse.json({ error: "axisId_required" }, { status: 400 });

  const contact = await loadProfile(req, ctx.effectiveUserId);
  if (!contact?.personProfile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Accepts either identifier the caller has in hand: the page holds PersonAxis ids (that
  // is what its list is keyed by), a script is more likely to hold the RadarAxis id.
  // Either way the row must belong to THIS person's profile — an axis id from another
  // person must not be mutable through their page.
  const owned = await prisma.personAxis.findFirst({
    where: { personProfileId: contact.personProfile.id, OR: [{ id: axisId }, { axisId }] },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Muted, never deleted: the tag stays on screen greyed with a way back, and a rebuild
  // still sees the correction.
  await prisma.personAxis.update({ where: { id: owned.id }, data: { mutedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
