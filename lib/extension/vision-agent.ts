/**
 * Claude vision agent.
 *
 * Given a screenshot, a goal, and the action history, asks Claude (Opus 4.8) to
 * decide the single next browser action. Used by the extension's CDP loop to drive
 * LinkedIn message sends visually — far more robust than brittle DOM selectors against
 * LinkedIn's obfuscated, hashed-class UI, and it naturally dismisses interstitials
 * (e.g. the "Reactivate Premium" popup) that block a deterministic click.
 *
 * The action is produced via a forced tool call (`next_action`), so the result is always
 * a schema-valid Action — no fragile JSON-string parsing.
 *
 * This function never throws: every failure mode (no key, network, API error, empty
 * response) is returned as a `fail` Action so the caller records it gracefully.
 */
import Anthropic from "@anthropic-ai/sdk";

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

const MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are a browser automation agent operating a real LinkedIn page through a screenshot. You receive a screenshot, a goal, and the history of actions you've already taken. Decide the SINGLE next action by calling the next_action tool exactly once.

The user's message text is already on the OS clipboard. To insert it into the LinkedIn compose box, first click the compose contenteditable area to focus it, then call next_action with action "paste".

Rules:
1. If a modal or popup blocks the page (a "Reactivate Premium" / Premium upsell, a cookie banner, an interstitial, a "Got it" dialog), close it FIRST — click its X / Dismiss / Close / "No thanks" control, or press Escape. A popup will silently swallow clicks aimed at the button behind it, so never click a profile button while a popup is open.
2. To open the message composer, click the "Message" button on the profile (English "Message" or Hebrew "הודעה"). It sits in the profile's top card, near the name — not the floating messaging bar at the bottom-right.
3. After the composer opens, click the message text area, then "paste".
4. After pasting, click the Send button (look for "Send" / "שלח" / a paper-plane icon, usually bottom-right of the composer).
5. After clicking Send, look at the next screenshot. If the message bubble now appears in the conversation, or the composer cleared/closed, the send succeeded — return action "done".
6. Coordinates are in pixels measured on the screenshot you were given. Aim for the CENTER of the target element.
7. If the goal genuinely cannot be achieved (e.g. the profile shows you are not connected and only InMail/Premium is offered with no free compose box), return action "fail" with a clear reason.
8. Never invent state. Base every decision only on what is visible in the CURRENT screenshot. Use the history to avoid repeating an action that didn't work — try a different target or dismiss a blocker instead.`;

// Forced-tool input schema = the Action union. A forced tool call guarantees a
// schema-valid object, so we never parse free-form text.
const NEXT_ACTION_TOOL: Anthropic.Tool = {
  name: "next_action",
  description: "Emit the single next browser action to take toward the goal.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["click", "paste", "type", "key", "scroll", "wait", "done", "fail"],
        description: "The kind of action to take.",
      },
      x: { type: "number", description: "click: x pixel coordinate (center of target)." },
      y: { type: "number", description: "click: y pixel coordinate (center of target)." },
      text: { type: "string", description: "type: the literal short string to type (NOT the message — use paste for that)." },
      key: { type: "string", enum: ["Enter", "Escape", "Tab"], description: "key: which key to press." },
      dy: { type: "number", description: "scroll: vertical pixels to scroll (positive = down)." },
      ms: { type: "number", description: "wait: milliseconds to wait (max 2000)." },
      reasoning: { type: "string", description: "One short sentence on why this action, based on what's visible." },
      reason: { type: "string", description: "fail: why the goal cannot be achieved." },
    },
    required: ["action"],
  },
};

function coerceAction(input: Record<string, unknown>): Action {
  const reasoning = typeof input.reasoning === "string" ? input.reasoning : "";
  switch (input.action) {
    case "click":
      if (typeof input.x === "number" && typeof input.y === "number")
        return { action: "click", x: input.x, y: input.y, reasoning };
      break;
    case "paste":
      return { action: "paste", reasoning };
    case "type":
      if (typeof input.text === "string") return { action: "type", text: input.text, reasoning };
      break;
    case "key":
      if (input.key === "Enter" || input.key === "Escape" || input.key === "Tab")
        return { action: "key", key: input.key, reasoning };
      break;
    case "scroll":
      if (typeof input.dy === "number") return { action: "scroll", dy: input.dy, reasoning };
      break;
    case "wait":
      if (typeof input.ms === "number") return { action: "wait", ms: input.ms, reasoning };
      break;
    case "done":
      return { action: "done", reasoning };
    case "fail":
      return { action: "fail", reason: typeof input.reason === "string" ? input.reason : reasoning || "unspecified" };
  }
  return { action: "fail", reason: `schema_mismatch: ${JSON.stringify(input).slice(0, 200)}` };
}

export async function callVisionAgent(input: CallVisionAgentInput): Promise<Action> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { action: "fail", reason: "ANTHROPIC_API_KEY is not set" };

  const { screenshot, goal, history } = input;
  const client = new Anthropic({ apiKey });

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // A tight per-step decision in a real-time clicking loop — keep latency low.
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      tools: [NEXT_ACTION_TOOL],
      tool_choice: { type: "tool", name: "next_action" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Goal: ${goal}\n\nActions you have already taken (most recent last):\n${JSON.stringify(history)}\n\nDecide the single next action.`,
            },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshot },
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { action: "fail", reason: `anthropic_${err.status ?? "error"}: ${err.message.slice(0, 200)}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "fail", reason: `network: ${msg}` };
  }

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "next_action",
  );
  if (!toolUse) return { action: "fail", reason: "no_tool_use_in_response" };

  return coerceAction(toolUse.input as Record<string, unknown>);
}
