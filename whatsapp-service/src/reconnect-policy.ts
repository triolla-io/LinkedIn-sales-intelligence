// Reconnect policy for WhatsApp sessions.
//
// Kept dependency-free and side-effect-free on purpose: the 2026-08-18 incident
// was a control-flow bug (a pairing session that could never succeed reconnected
// 7,141 times in 81 minutes with nobody watching), and control flow is only
// trustworthy if it can be unit-tested away from Baileys and the socket.

/** Delay before the first retry. */
export const RECONNECT_BASE_MS = 3_000;

/** Ceiling for the exponential backoff — an established session keeps retrying
 *  at this interval indefinitely, which is ~1 attempt every 5 min. */
export const RECONNECT_MAX_MS = 300_000;

/** How many times we retry a session that has never completed pairing. Past
 *  this we stop and let the user re-open the QR screen, rather than hammering
 *  WhatsApp forever with a handshake it keeps rejecting. */
export const MAX_PAIRING_ATTEMPTS = 5;

export interface ReconnectInput {
  /** WhatsApp ended the session (401/403/badSession); creds are gone. */
  loggedOut: boolean;
  /** The user pressed Disconnect. */
  userInitiated: boolean;
  /** Someone is subscribed to this user's event stream (QR screen is open). */
  hasListeners: boolean;
  /** This session reached `connection === "open"` at least once. */
  everConnected: boolean;
  /** Consecutive failed reconnects so far. */
  attempt: number;
}

export interface ReconnectDecision {
  reconnect: boolean;
  reason: string;
}

/**
 * Exponential backoff, clamped to [RECONNECT_BASE_MS, RECONNECT_MAX_MS].
 * Deterministic (no jitter) so the policy stays testable; there is at most one
 * reconnect chain per user, so there is no thundering herd to spread out.
 */
export function backoffDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  // Cap the exponent before shifting so we never overflow into Infinity/NaN.
  const exponent = Math.min(safeAttempt, 32);
  const delay = RECONNECT_BASE_MS * 2 ** exponent;
  return Math.min(delay, RECONNECT_MAX_MS);
}

/**
 * Decide whether a closed session should be reconnected.
 *
 * The critical rule is `no_listeners`: a session that has never paired and has
 * nobody watching must NOT reconnect. Without it, one page visit starts a chain
 * that outlives the browser tab and never terminates.
 */
export function shouldReconnect(input: ReconnectInput): ReconnectDecision {
  if (input.loggedOut) return { reconnect: false, reason: "logged_out" };
  if (input.userInitiated) return { reconnect: false, reason: "user_initiated" };

  // An established session backs the background senders, so it must heal itself
  // after a transient drop whether or not a browser is attached. The backoff cap
  // keeps this cheap (~12 attempts/hour at steady state).
  if (input.everConnected) return { reconnect: true, reason: "restore_established_session" };

  if (!input.hasListeners) return { reconnect: false, reason: "no_listeners" };

  if (input.attempt >= MAX_PAIRING_ATTEMPTS) {
    return { reconnect: false, reason: "pairing_attempts_exhausted" };
  }

  return { reconnect: true, reason: "pairing_retry" };
}
