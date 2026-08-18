/**
 * Tolerant JSON extraction for LLM responses, shared by every Tech Radar stage.
 *
 * Two failure modes have actually occurred in this repo and both are handled here:
 *   1. The model wraps its JSON in ```json fences despite response_format.
 *   2. A long response is truncated mid-array, so JSON.parse throws and the
 *      caller silently gets zero results. `parseJsonLoose` recovers whole
 *      elements from a truncated array instead of losing the entire batch.
 *
 * No prisma import — this file is safe for client bundles.
 */

/** Strip markdown fences and any prose surrounding the JSON body. */
export function stripFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (fence ? fence[1] : text).trim();
}

/** Parse an LLM JSON response. Returns null rather than throwing. */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  const body = stripFences(text);
  try {
    return JSON.parse(body) as T;
  } catch {
    // Truncated output: recover the longest prefix that still closes cleanly.
    const repaired = repairTruncatedJson(body);
    if (!repaired) return null;
    try {
      return JSON.parse(repaired) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Best-effort repair of output cut off mid-structure: walk the text tracking
 * string/escape state and brace depth, rewind to the last position where a
 * complete element ended, then close the open containers.
 */
export function repairTruncatedJson(body: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1;
  // Depth at the rewind point. Containers opened AFTER lastSafe are discarded,
  // so only the ones open at that moment may be closed — closing the whole
  // final stack would emit closers for containers we just threw away.
  let lastSafeDepth = 0;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] !== ch) return null;
      stack.pop();
      // A closed element inside a container is a safe rewind point.
      if (stack.length > 0) {
        lastSafe = i;
        lastSafeDepth = stack.length;
      }
    }
  }

  if (stack.length === 0) return null; // not a truncation problem
  if (lastSafe < 0) return null; // nothing complete to salvage

  const closers = stack.slice(0, lastSafeDepth).reverse().join("");
  return `${body.slice(0, lastSafe + 1)}${closers}`;
}

/** Clamp an unknown score into [0,1], defaulting to `fallback`. */
export function clampScore(raw: unknown, fallback = 0.5): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
