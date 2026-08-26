/**
 * The pilot gate: a freshly drafted radar message is born held — invisible to its
 * owner, visible only to a reviewer — until a deliberate act releases it.
 *
 * Default-ON is deliberate. The pilot gate protects a real person's inbox (Yuval's),
 * and nobody can set an environment variable on the production container tonight, so
 * the gate must hold WITHOUT anyone touching config. It holds unless someone
 * explicitly turns it off with RADAR_PILOT_HOLD=off — that is the release valve, not
 * an opt-in switch. Never invert this to opt-in.
 *
 * Pure, no prisma: a client component reads `pilotHeld` off the API payload instead
 * of importing this file, but server code (the route, the drafting path, the release
 * script) all call these functions directly.
 */

const OFF_VALUES = new Set(["off", "0", "false"]);

/** Reviewer emails, comma-separated, from RADAR_PILOT_REVIEWERS. Default: ariel@triolla.io */
export function pilotReviewers(env?: NodeJS.ProcessEnv): string[] {
  const raw = (env ?? process.env).RADAR_PILOT_REVIEWERS;
  if (!raw || !raw.trim()) return ["ariel@triolla.io"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The gate is ON unless RADAR_PILOT_HOLD is explicitly "off"/"0"/"false" (case-insensitive). */
export function pilotHoldEnabled(env?: NodeJS.ProcessEnv): boolean {
  const raw = (env ?? process.env).RADAR_PILOT_HOLD;
  if (raw === undefined) return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

/** True when this email may see held drafts. Case-insensitive, trims. Null/undefined → false. */
export function isPilotReviewer(email: string | null | undefined, env?: NodeJS.ProcessEnv): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return pilotReviewers(env).some((r) => r.trim().toLowerCase() === normalized);
}
