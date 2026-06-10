/**
 * OpenRouter vision agent client.
 *
 * Calls Google Gemini 2.0 Flash (free) via OpenRouter to decide the next
 * browser action given a screenshot, goal, and action history.
 *
 * This function is intentionally robust: it never throws. All failure modes
 * (network, non-JSON, schema mismatch, OpenRouter error) are returned as a
 * `fail` Action so the caller can record them gracefully.
 */

export type Action =
  | { action: "click"; x: number; y: number; reasoning: string }
  | { action: "paste"; reasoning: string }
  | { action: "type"; text: string; reasoning: string }
  | { action: "key"; key: "Enter" | "Escape" | "Tab"; reasoning: string }
  | { action: "scroll"; dy: number; reasoning: string }
  | { action: "wait"; ms: number; reasoning: string }
  | { action: "done"; reasoning: string }
  | { action: "fail"; reason: string };

export type AgentHistoryEntry = { action: string; reasoning?: string };

export type CallVisionAgentInput = {
  screenshot: string; // base64-encoded PNG, no data: prefix
  goal: string;
  history: AgentHistoryEntry[];
};

const SYSTEM_PROMPT = `You are a browser automation agent for LinkedIn. You receive a screenshot and a goal. You output ONE next action as a single JSON object (no prose, no markdown fences).

The user's message text is already on the OS clipboard. To insert it into the LinkedIn compose box, first click the compose contenteditable area to focus it, then return {"action":"paste"}.

Allowed actions (return EXACTLY one JSON object):
- {"action":"click","x":<viewport-x>,"y":<viewport-y>,"reasoning":"..."}
- {"action":"paste","reasoning":"..."}              # only after the compose box is focused
- {"action":"type","text":"...","reasoning":"..."}  # for short literal strings, NOT the message
- {"action":"key","key":"Enter"|"Escape"|"Tab","reasoning":"..."}
- {"action":"scroll","dy":<px>,"reasoning":"..."}
- {"action":"wait","ms":<ms>,"reasoning":"..."}     # use sparingly, max 2000
- {"action":"done","reasoning":"message visibly sent"}
- {"action":"fail","reason":"..."}                   # e.g. profile not messageable

Rules:
1. If a modal/popup blocks the page (Premium upsell, cookie banner, etc.), close it first (click X / Dismiss / Close).
2. To open the message composer, click the "Message" button on the profile (English or Hebrew "הודעה").
3. After the composer opens, click the contenteditable text area, then paste.
4. After paste, click the Send button (look for "Send" / "שלח" / paper-plane icon, usually bottom-right of the composer).
5. After clicking send, observe the next screenshot. If the message bubble appears in the conversation OR the composer clears, return {"action":"done"}.
6. Coordinates are in viewport pixels. Aim for the center of the target element.
7. If the goal cannot be achieved (e.g. profile shows "You're not connected"), return fail with reason.
8. Never invent state. Base every decision on what you can see in the current screenshot.`;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-001";

function isValidAction(value: unknown): value is Action {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  switch (v.action) {
    case "click":
      return typeof v.x === "number" && typeof v.y === "number" && typeof v.reasoning === "string";
    case "paste":
      return typeof v.reasoning === "string";
    case "type":
      return typeof v.text === "string" && typeof v.reasoning === "string";
    case "key":
      return (
        (v.key === "Enter" || v.key === "Escape" || v.key === "Tab") &&
        typeof v.reasoning === "string"
      );
    case "scroll":
      return typeof v.dy === "number" && typeof v.reasoning === "string";
    case "wait":
      return typeof v.ms === "number" && typeof v.reasoning === "string";
    case "done":
      return typeof v.reasoning === "string";
    case "fail":
      return typeof v.reason === "string";
    default:
      return false;
  }
}

function stripFences(s: string): string {
  // Some models wrap JSON in ```json ... ``` despite response_format.
  const trimmed = s.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  return trimmed;
}

export async function callVisionAgent(input: CallVisionAgentInput): Promise<Action> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const { screenshot, goal, history } = input;

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Goal: ${goal}\n\nHistory (most recent last):\n${JSON.stringify(history)}`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${screenshot}` },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 300,
    temperature: 0,
  };

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "fail", reason: `network: ${msg}` };
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    return { action: "fail", reason: `openrouter_${res.status}: ${detail}` };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "fail", reason: `parse_error: response_not_json: ${msg}` };
  }

  const raw =
    (payload as { choices?: Array<{ message?: { content?: string } }> })
      ?.choices?.[0]?.message?.content ?? "";

  if (!raw) {
    return { action: "fail", reason: "parse_error: empty_completion" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { action: "fail", reason: `parse_error: ${raw.slice(0, 200)}` };
  }

  if (!isValidAction(parsed)) {
    return {
      action: "fail",
      reason: `parse_error: schema_mismatch: ${JSON.stringify(parsed).slice(0, 200)}`,
    };
  }

  return parsed;
}
