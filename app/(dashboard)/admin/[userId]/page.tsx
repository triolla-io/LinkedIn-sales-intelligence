"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface UserDetails {
  id: string;
  name: string;
  email: string;
  role: string;
  contactCount: number;
  lastSyncedAt: string | null;
  creditsConsumed: number;
}

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((users: UserDetails[]) => {
        const found = users.find((u) => u.id === userId);
        setUser(found ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-100 rounded w-64" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6">
        <p className="text-gray-500 text-sm">משתמש לא נמצא.</p>
        <Link href="/admin/users" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          חזור למשתמשים
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/users"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
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
        <button
          onClick={() => router.push("/contacts")}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          צפה באנשי קשר (תצוגת התחזות)
        </button>
      </div>
    </div>
  );
}
