import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  // Dynamic segment is read from the URL manually since withTenant wraps the whole handler
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
