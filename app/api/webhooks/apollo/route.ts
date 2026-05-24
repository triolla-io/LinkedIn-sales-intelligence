import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Normalise a LinkedIn profile URL to its canonical /in/<slug> form. */
function normalizeLinkedinUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `https://www.linkedin.com${path}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

/** Apply the same phone priority logic used in matchPerson: work_direct > work > other > mobile > phones[0]. */
function pickPhone(
  phones: Array<{ sanitized_number?: string; type?: string }>
): string | undefined {
  return (
    phones.find((p) => p.type === "work_direct")?.sanitized_number ??
    phones.find((p) => p.type === "work")?.sanitized_number ??
    phones.find((p) => p.type === "other")?.sanitized_number ??
    phones.find((p) => p.type === "mobile")?.sanitized_number ??
    phones[0]?.sanitized_number
  );
}

export async function POST(req: NextRequest) {
  // ── 1. Verify shared secret ───────────────────────────────────────────────
  const incomingSecret = req.headers.get("x-apollo-webhook-secret");
  const expectedSecret = process.env.APOLLO_WEBHOOK_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse payload ──────────────────────────────────────────────────────
  let payload: {
    person?: {
      linkedin_url?: string;
      phone_numbers?: Array<{ sanitized_number?: string; type?: string }>;
    };
  };

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const linkedinUrl = payload.person?.linkedin_url;
  if (!linkedinUrl) {
    return NextResponse.json({ error: "Missing linkedin_url in payload" }, { status: 400 });
  }

  const phones = payload.person?.phone_numbers ?? [];
  const phone = pickPhone(phones);
  if (!phone) {
    return NextResponse.json({ ok: true, updated: false });
  }

  // ── 3. Look up contact by linkedinUrl (normalised) ────────────────────────
  const normalizedUrl = normalizeLinkedinUrl(linkedinUrl);

  const contact = await prisma.contact.findFirst({
    where: {
      OR: [
        { linkedinUrl: linkedinUrl, removedAt: null },
        { linkedinUrl: normalizedUrl, removedAt: null },
      ],
    },
    include: { owner: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 400 });
  }

  // ── 4. Update Contact.phone and PersonEnrichment.phone ────────────────────
  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contact.id },
      data: { phone },
    }),
    prisma.personEnrichment.updateMany({
      where: {
        orgId: contact.owner.orgId,
        linkedinUrlNormalized: normalizedUrl,
      },
      data: { phone },
    }),
  ]);

  return NextResponse.json({ ok: true, updated: true, contactId: contact.id });
}
