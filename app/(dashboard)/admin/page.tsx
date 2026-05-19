import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminClient from "./admin-client";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    redirect("/contacts");
  }

  return <AdminClient />;
}
