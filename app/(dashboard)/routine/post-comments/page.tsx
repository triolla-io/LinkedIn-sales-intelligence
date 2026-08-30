import { MessageSquareText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PostCommentsClient, PostCommentsModuleSwitch } from "./post-comments-client";

/**
 * Server page for the post-comments module. Session auth is already enforced one level
 * up by app/(dashboard)/layout.tsx. The org-level `postCommentsEnabled` flag is
 * deliberately NOT gated via redirect — mirroring fintech-radar / tech-radar /
 * company-signals, it is surfaced client-side as an inline on/off switch so the user can
 * manage who they follow and review already-drafted comments while the module is off.
 */
export default function PostCommentsPage() {
  return (
    <div className="flex flex-col h-full min-h-screen bg-[var(--background)]">
      <PageHeader
        icon={MessageSquareText}
        title="תגובות לפוסטים"
        subtitle="תגובה קצרה שמוכנה כל בוקר לאנשים שאתם עוקבים אחריהם בלינקדאין"
        actions={<PostCommentsModuleSwitch />}
      />
      <PostCommentsClient />
    </div>
  );
}
