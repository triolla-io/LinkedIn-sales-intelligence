import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";
import type { ActionInfo, OverviewFeedItem } from "@/components/dashboard/today-overview";

/**
 * "היום" — דף הבית.
 *
 * מעל: הסיפור של הבוקר (ApprovalsTab) — הדבר היחיד שדורש החלטה.
 * מתחת: מבט־על על הרשת. כל מספר כאן נשלף עם ההשוואה שלו, כי מספר
 * בלי הקשר הוא קישוט. הכול נשלף בשרת בקריאה אחת — למסך הזה אין
 * מצב טעינה משלו, הוא מגיע מלא.
 */

/** מספר האנשים (לא ההודעות) שנשלחה אליהם הודעה בפועל בטווח. */
async function peopleContacted(senderId: string, gte: Date, lt?: Date): Promise<number> {
  const rows = await prisma.sentMessage.groupBy({
    by: ["contactId"],
    where: { senderId, status: "SENT", sentAt: lt ? { gte, lt } : { gte } },
  });
  return rows.length;
}

/** שם המקור הראשון מתוך sources: Json — בלי לסמוך על הצורה. */
function firstSourceName(sources: unknown): string | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const first = sources[0];
  if (first && typeof first === "object" && "name" in first) {
    const name = (first as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const ownerId = session.user.id;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const since30 = new Date(now.getTime() - 30 * 864e5);
  const since7 = new Date(now.getTime() - 7 * 864e5);
  const since8w = new Date(startOfToday.getTime() - 55 * 864e5); // 8 דליים שבועיים

  const ownedCompanies = { contacts: { some: { ownerId, removedAt: null } } };
  const ownedContact = { ownerId, removedAt: null };

  const [
    user,
    contactCount,
    addedThisMonth,
    onRadar,
    latestImport,
    signals30,
    signalsToday,
    signals7,
    jobChanges30,
    jobChangesToday,
    jobChanges7,
    recentSignals,
    recentJobChanges,
    sentToday,
    sentMonth,
    sentPrevMonth,
    sentYtd,
    pendingDrafts,
    lastScan,
    sentForWeekly,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: ownerId } }),
    prisma.contact.count({ where: ownedContact }),
    prisma.contact.count({ where: { ...ownedContact, createdAt: { gte: startOfMonth } } }),
    prisma.contact.count({ where: { ...ownedContact, radarInclude: true } }),
    prisma.import.findFirst({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      select: { added: true, createdAt: true },
    }),
    prisma.companySignal.count({ where: { detectedAt: { gte: since30 }, company: ownedCompanies } }),
    prisma.companySignal.count({ where: { detectedAt: { gte: startOfToday }, company: ownedCompanies } }),
    prisma.companySignal.count({ where: { detectedAt: { gte: since7 }, company: ownedCompanies } }),
    prisma.contactJobChange.count({ where: { detectedAt: { gte: since30 }, contact: ownedContact } }),
    prisma.contactJobChange.count({ where: { detectedAt: { gte: startOfToday }, contact: ownedContact } }),
    prisma.contactJobChange.count({ where: { detectedAt: { gte: since7 }, contact: ownedContact } }),
    prisma.companySignal.findMany({
      where: { detectedAt: { gte: since30 }, company: ownedCompanies },
      orderBy: { detectedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        sources: true,
        detectedAt: true,
        company: { select: { name: true } },
      },
    }),
    prisma.contactJobChange.findMany({
      where: { detectedAt: { gte: since30 }, contact: ownedContact },
      orderBy: { detectedAt: "desc" },
      take: 8,
      select: {
        id: true,
        newTitle: true,
        newCompany: true,
        prevCompany: true,
        detectedAt: true,
        contact: { select: { fullName: true } },
      },
    }),
    peopleContacted(ownerId, startOfToday),
    peopleContacted(ownerId, startOfMonth),
    peopleContacted(ownerId, startOfPrevMonth, startOfMonth),
    peopleContacted(ownerId, startOfYear),
    prisma.radarDraft.findMany({
      // אותם תנאים כמו מסך האישורים: מה שעוד רלוונטי להחלטה של יובל
      where: {
        ownerId,
        status: { in: ["PENDING_REVIEW", "PREPARING", "PREPARED"] },
        supersededAt: null,
      },
      select: { contact: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.radarScanRun.findFirst({
      where: { finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { scanned: true, vetoed: true, finishedAt: true },
    }),
    prisma.sentMessage.findMany({
      where: { senderId: ownerId, status: "SENT", sentAt: { gte: since8w } },
      select: { contactId: true, sentAt: true },
    }),
  ]);

  /* קצב שבועי — אנשים ייחודיים פר שבוע, 8 דליים שהאחרון נגמר היום */
  const weekly = Array.from({ length: 8 }, () => new Set<string>());
  const bucketMs = 7 * 864e5;
  const horizonEnd = startOfToday.getTime() + 864e5;
  for (const m of sentForWeekly) {
    const idx = 7 - Math.floor((horizonEnd - m.sentAt.getTime() - 1) / bucketMs);
    if (idx >= 0 && idx < 8) weekly[idx].add(m.contactId);
  }

  const action: ActionInfo = {
    pending: {
      count: pendingDrafts.length,
      names: pendingDrafts.map((d) => d.contact.fullName).slice(0, 3),
    },
    scan: lastScan?.finishedAt
      ? {
          scanned: lastScan.scanned,
          vetoed: lastScan.vetoed,
          finishedAt: lastScan.finishedAt.toISOString(),
        }
      : null,
  };

  if (!user) redirect("/sign-in");

  /* שני מקורות, פיד אחד — ממוזג לפי זמן ולא לפי סוג */
  const feed: OverviewFeedItem[] = [
    ...recentSignals.map((s) => ({
      id: `signal:${s.id}`,
      kind: "company" as const,
      title: s.title,
      source: [firstSourceName(s.sources), s.company.name].filter(Boolean).join(" · "),
      at: s.detectedAt.toISOString(),
      isNew: s.detectedAt >= startOfToday,
    })),
    ...recentJobChanges.map((j) => {
      const name = j.contact.fullName;
      const title = j.newTitle
        ? `${name} מונה ל־${j.newTitle}${j.newCompany ? ` ב־${j.newCompany}` : ""}`
        : j.newCompany
          ? `${name} עבר ל־${j.newCompany}`
          : `${name} עדכן את הפרופיל`;
      return {
        id: `job:${j.id}`,
        kind: "person" as const,
        title,
        source: ["לינקדאין", j.prevCompany ? `קודם ב־${j.prevCompany}` : null]
          .filter(Boolean)
          .join(" · "),
        at: j.detectedAt.toISOString(),
        isNew: j.detectedAt >= startOfToday,
      };
    }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return (
    <DashboardClient
      user={{ name: user.name, email: user.email, image: user.image }}
      overview={{
        action,
        weekly: weekly.map((set) => set.size),
        contacts: { total: contactCount, addedThisMonth, onRadar },
        companyUpdates: { total: signals30, fresh: signalsToday },
        peopleUpdates: { total: jobChanges30, fresh: jobChangesToday },
        outreach: { today: sentToday, month: sentMonth, prevMonth: sentPrevMonth, ytd: sentYtd },
        feed,
        feedTotalThisWeek: signals7 + jobChanges7,
        latestImport: latestImport
          ? { createdAt: latestImport.createdAt.toISOString(), added: latestImport.added }
          : null,
      }}
    />
  );
}
