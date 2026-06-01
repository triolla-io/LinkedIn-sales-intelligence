import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "fs";
import { withExtensionAuth } from "@/lib/extension/with-extension-auth";
import { callVisionAgent, type AgentHistoryEntry } from "@/lib/extension/openrouter";

type Body = {
  screenshot?: unknown;
  goal?: unknown;
  history?: unknown;
};

function isHistoryEntry(v: unknown): v is AgentHistoryEntry {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (typeof r.action !== "string") return false;
  if (r.reasoning !== undefined && typeof r.reasoning !== "string") return false;
  return true;
}

export async function POST(req: NextRequest): Promise<Response> {
  return withExtensionAuth(async (req) => {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (typeof body.screenshot !== "string" || body.screenshot.length === 0) {
      return NextResponse.json(
        { error: "invalid_body", detail: "screenshot must be a non-empty base64 string" },
        { status: 400 },
      );
    }
    if (typeof body.goal !== "string" || body.goal.length === 0) {
      return NextResponse.json(
        { error: "invalid_body", detail: "goal must be a non-empty string" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.history) || !body.history.every(isHistoryEntry)) {
      return NextResponse.json(
        { error: "invalid_body", detail: "history must be an array of {action, reasoning?}" },
        { status: 400 },
      );
    }

    // Debug: save first screenshot (step 0) to /tmp for inspection
    if (body.history.length === 0) {
      try { writeFileSync("/tmp/agent-step0.png", Buffer.from(body.screenshot, "base64")); } catch {}
    }

    const action = await callVisionAgent({
      screenshot: body.screenshot,
      goal: body.goal,
      history: body.history,
    });

    return NextResponse.json(action);
  })(req);
}
