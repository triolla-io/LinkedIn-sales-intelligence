import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ArrowRight, UserRound } from "lucide-react";
import Link from "next/link";
import { ui } from "@/lib/ui";
import { PageHeader } from "@/components/ui/page-header";

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

const STAT_LABEL = "text-xs font-medium text-[#9b9895] uppercase tracking-wider mb-1";
const STAT_VALUE = "text-sm text-[#1a1917]";

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
      <div className="w-full max-w-2xl mx-auto px-6 pt-6" dir="rtl">
        <p className="text-[#6b6866] text-sm">משתמש לא נמצא.</p>
        <Link href="/admin/users" className="text-[#1585ff] hover:text-[#0a70e0] text-sm mt-2 inline-block">
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
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <PageHeader icon={UserRound} title={user.name} subtitle={user.email} />

      <div className="w-full max-w-2xl mx-auto px-6 pt-5 pb-10 space-y-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-[#6b6866] hover:text-[#1a1917] transition-colors"
        >
          <ArrowRight className="size-4" />
          חזור למשתמשים
        </Link>

        <div className={`${ui.card} p-5`}>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className={STAT_LABEL}>תפקיד</p>
              <p className={STAT_VALUE}>{user.role}</p>
            </div>
            <div>
              <p className={STAT_LABEL}>סך הכל אנשי קשר</p>
              <p className={STAT_VALUE}>{user.contactCount.toLocaleString()}</p>
            </div>
            <div>
              <p className={STAT_LABEL}>קרדיטים בשימוש</p>
              <p className={STAT_VALUE}>{user.creditsConsumed}</p>
            </div>
            <div>
              <p className={STAT_LABEL}>סנכרן אחרון</p>
              <p className={STAT_VALUE}>
                {user.lastSyncedAt ? new Date(user.lastSyncedAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "לעולם לא"}
              </p>
            </div>
          </div>
        </div>

        <Link href="/contacts" className={ui.btnPrimary}>
          צפה באנשי קשר (תצוגת התחזות)
        </Link>
      </div>
    </div>
  );
}
