import { Suspense } from "react";
import { LinkedMark } from "@/components/ui/logo";
import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import { AcceptInviteContent } from "./accept-invite-content";

export const metadata: Metadata = { title: "Accept Invite" };

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-8">
      <div className="w-full max-w-sm bg-surface rounded-2xl border border-[var(--line)] p-8 shadow-sm">
        <div className="mb-6 flex justify-center text-[var(--foreground)]">
          <LinkedMark className="h-7 w-auto" />
        </div>
        <Suspense fallback={<RefreshCw className="size-6 text-[var(--accent)] animate-spin mx-auto" />}>
          <AcceptInviteContent />
        </Suspense>
      </div>
    </div>
  );
}
