import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import ContactsClient from "./contacts-client";

const DEFAULT_PAGE_SIZE = 15;
import type { Contact } from "@/components/dashboard/contact-table";

const SHARED_SELECT = {
  id: true,
  linkedinUrl: true,
  fullName: true,
  headline: true,
  currentTitle: true,
  currentCompany: true,
  companySize: true,
  seniority: true,
  function: true,
  location: true,
  industry: true,
  profilePicUrl: true,
  lastSyncedAt: true,
  email: true,
  phone: true,
  enrichedAt: true,
  manualFields: true,
  hebrewFirstName: true,
  company: { select: { staffCount: true, industry: true } },
} as const;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const sp = await searchParams;

  function sp2arr(key: string): string[] {
    const v = sp[key];
    if (!v) return [];
    return (Array.isArray(v) ? v : v.split(",")).filter(Boolean);
  }

  const q = typeof sp.q === "string" ? sp.q : undefined;
  const seniority = sp2arr("seniority");
  const fn = sp2arr("function");
  const titleSearch = sp2arr("titleSearch");
  const industry = sp2arr("industry");
  const hasEmail = sp.hasEmail === "true";
  const hasPhone = sp.hasPhone === "true";
  const listId = typeof sp.listId === "string" ? sp.listId : undefined;

  const andClauses: any[] = [];
  if (q) {
    andClauses.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { headline: { contains: q, mode: "insensitive" } },
        { currentCompany: { contains: q, mode: "insensitive" } },
        { currentTitle: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (titleSearch.length) {
    andClauses.push({
      OR: titleSearch.map((t) => ({
        OR: [
          { currentTitle: { contains: t, mode: "insensitive" } },
          { headline: { contains: t, mode: "insensitive" } },
        ],
      })),
    });
  }
  if (industry.length) {
    andClauses.push({
      OR: industry.map((i) => ({
        industry: { contains: i, mode: "insensitive" },
      })),
    });
  }

  const where: any = {
    ownerId: session.user.id,
    removedAt: null,
    ...(seniority.length ? { seniority: { in: seniority as any } } : {}),
    ...(fn.length ? { function: { in: fn as any } } : {}),
    ...(hasEmail ? { email: { not: null } } : {}),
    ...(hasPhone ? { phone: { not: null } } : {}),
    ...(andClauses.length ? { AND: andClauses } : {}),
    ...(listId ? { lists: { some: { listId } } } : {}),
  };

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ lastSyncedAt: "desc" }, { id: "desc" }],
      take: DEFAULT_PAGE_SIZE,
      select: SHARED_SELECT,
    }),
    prisma.contact.count({ where }),
  ]);

  return (
    <ContactsClient
      initialContacts={contacts as unknown as Contact[]}
      initialTotal={total}
    />
  );
}
