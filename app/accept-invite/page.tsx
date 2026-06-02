import { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import { AcceptInviteContent } from "./accept-invite-content";

export const metadata: Metadata = { title: "Accept Invite" };

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen bg-[#f6f5f3] flex items-center justify-center p-8">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[#e5e3df] p-8 shadow-sm">
        <div className="size-10 bg-[#1585ff] rounded-xl flex items-center justify-center mb-6 mx-auto">
          <span className="text-white text-sm font-bold font-mono">SI</span>
        </div>
        <Suspense fallback={<RefreshCw className="size-6 text-[#1585ff] animate-spin mx-auto" />}>
          <AcceptInviteContent />
        </Suspense>
      </div>
    </div>
  );
}
