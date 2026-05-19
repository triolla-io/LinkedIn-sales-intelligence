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
  linkedinStatus: string;
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
        <p className="text-gray-500 text-sm">User not found.</p>
        <Link href="/admin/users" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          Back to users
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
          Back to users
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{user.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{user.email}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Role</p>
            <p className="text-sm text-gray-900">{user.role}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">LinkedIn Status</p>
            <p className="text-sm text-gray-900">{user.linkedinStatus}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Total Contacts</p>
            <p className="text-sm text-gray-900">{user.contactCount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Credits Used</p>
            <p className="text-sm text-gray-900">{user.creditsConsumed}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Last Synced</p>
            <p className="text-sm text-gray-900">
              {user.lastSyncedAt
                ? new Date(user.lastSyncedAt).toLocaleString()
                : "Never"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={() => router.push("/contacts")}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          View Contacts (impersonation view)
        </button>
      </div>
    </div>
  );
}
