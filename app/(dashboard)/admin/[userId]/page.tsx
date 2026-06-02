import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

async function requireAdmin(): Promise<{ role: string; orgId: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, orgId: true },
  });
  if (!user || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) redirect("/contacts");
  return user;
}

interface UserDetails {
  id: string;
  name: string;
  email: string;
  role: string;
  contactCount: number;
  lastSyncedAt: string | null;
  creditsConsumed: number;
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const [{ userId }, currentUser] = await Promise.all([params, requireAdmin()]);

  const currentMonth = new Date().toISOString().slice(0, 7);

  const [targetUser, spend, syncStat] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, orgId: currentUser.orgId },
      include: { _count: { select: { contacts: true } } },
    }),
    prisma.enrichmentSpend.findUnique({
      where: { orgId_month: { orgId: currentUser.orgId, month: currentMonth } },
    }),
    prisma.contact.aggregate({
      where: { ownerId: userId, removedAt: null },
      _max: { lastSyncedAt: true },
    }),
  ]);

  if (!targetUser) {
    return (
      <div className="p-6">
        <p className="text-gray-500 text-sm">משתמש לא נמצא.</p>
        <Link href="/admin/users" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          חזור למשתמשים
        </Link>
      </div>
    );
  }

  const user: UserDetails = {
    id: targetUser.id,
    name: targetUser.name,
    email: targetUser.email,
    role: targetUser.role,
    contactCount: targetUser._count.contacts,
    lastSyncedAt: syncStat._max.lastSyncedAt?.toISOString() ?? null,
    creditsConsumed: spend?.credits ?? 0,
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/users"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
        >
          <ArrowLeft className="size-4" />
          חזור למשתמשים
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{user.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{user.email}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">תפקיד</p>
            <p className="text-sm text-gray-900">{user.role}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">סך הכל אנשי קשר</p>
            <p className="text-sm text-gray-900">{user.contactCount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">קרדיטים בשימוש</p>
            <p className="text-sm text-gray-900">{user.creditsConsumed}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">סנכרן אחרון</p>
            <p className="text-sm text-gray-900">
              {user.lastSyncedAt
                ? new Date(user.lastSyncedAt).toLocaleString()
                : "לעולם לא"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Link
          href="/contacts"
          className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          צפה באנשי קשר (תצוגת התחזות)
        </Link>
      </div>
    </div>
  );
}
