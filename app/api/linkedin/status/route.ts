import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sseStream } from "@/lib/linkedin/sse-bus";

/**
 * GET /api/linkedin/status
 * Returns a Server-Sent Events stream for the authenticated user's LinkedIn
 * connection state. The client subscribes once and receives push updates
 * for: linkedin:connecting, linkedin:connected, linkedin:syncing,
 *       linkedin:sync-progress, linkedin:expired.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stream = sseStream(session.user.id);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
