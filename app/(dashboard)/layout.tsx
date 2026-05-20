import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Sidebar from "@/components/dashboard/sidebar";
import ImpersonationBanner from "@/components/dashboard/impersonation-banner";
import EnrichmentProgress from "@/components/dashboard/enrichment-progress";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  const cookieStore = await cookies();
  const impersonationCookie = cookieStore.get("x-impersonation");
  let impersonatedUser: { name: string } | null = null;

  if (impersonationCookie?.value) {
    const found = await prisma.user.findUnique({
      where: { id: impersonationCookie.value },
      select: { name: true },
    });
    if (found) {
      impersonatedUser = { name: found.name };
    }
  }

  const user = {
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: session.user.image,
    role: session.user.role,
  };

  return (
    <div className="flex h-screen bg-[#f6f5f3]">
      <div className="w-[240px] shrink-0">
        <Sidebar user={user} />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        {impersonatedUser && (
          <ImpersonationBanner name={impersonatedUser.name} />
        )}
        <EnrichmentProgress />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
