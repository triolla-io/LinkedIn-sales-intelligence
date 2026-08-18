import { describe, it, expect } from "vitest";
import {
  backoffDelayMs,
  retryDelayMs,
  shouldReconnect,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  MAX_PAIRING_ATTEMPTS,
} from "../../whatsapp-service/src/reconnect-policy";

// Regression guard for the 2026-08-18 incident: a WhatsApp pairing session that
// could never succeed reconnected 7,141 times in 81 minutes with ZERO inbound
// HTTP connections — i.e. it kept hammering WhatsApp long after the user closed
// the tab, at a flat 90 attempts/minute with no backoff and no attempt cap.

describe("backoffDelayMs", () => {
  it("starts at the base delay for the first retry", () => {
    expect(backoffDelayMs(0)).toBe(RECONNECT_BASE_MS);
  });

  it("grows exponentially instead of retrying at a flat interval", () => {
    expect(backoffDelayMs(1)).toBe(RECONNECT_BASE_MS * 2);
    expect(backoffDelayMs(2)).toBe(RECONNECT_BASE_MS * 4);
    expect(backoffDelayMs(3)).toBe(RECONNECT_BASE_MS * 8);
  });

  it("is monotonically non-decreasing", () => {
    for (let a = 0; a < 30; a++) {
      expect(backoffDelayMs(a + 1)).toBeGreaterThanOrEqual(backoffDelayMs(a));
    }
  });

  it("caps the delay so a long-lived session still retries periodically", () => {
    expect(backoffDelayMs(50)).toBe(RECONNECT_MAX_MS);
    expect(backoffDelayMs(1000)).toBe(RECONNECT_MAX_MS);
  });

  it("never returns a delay that would busy-loop", () => {
    for (const a of [-5, -1, 0, 1, 7, 99]) {
      expect(backoffDelayMs(a)).toBeGreaterThanOrEqual(RECONNECT_BASE_MS);
    }
  });

  it("keeps the sustained attempt rate under 1 per minute once capped", () => {
    expect(RECONNECT_MAX_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("retryDelayMs", () => {
  it("retries pairing at a constant short delay so the QR refreshes promptly", () => {
    for (const a of [0, 1, 2, 3, 4]) {
      expect(retryDelayMs(a, false)).toBe(RECONNECT_BASE_MS);
    }
  });

  it("backs off an established session that is retrying unattended", () => {
    expect(retryDelayMs(0, true)).toBe(RECONNECT_BASE_MS);
    expect(retryDelayMs(3, true)).toBe(RECONNECT_BASE_MS * 8);
    expect(retryDelayMs(99, true)).toBe(RECONNECT_MAX_MS);
  });

  it("never makes an interactive user wait longer than a few seconds", () => {
    expect(retryDelayMs(MAX_PAIRING_ATTEMPTS, false)).toBeLessThanOrEqual(5_000);
  });
});

describe("shouldReconnect", () => {
  const base = {
    loggedOut: false,
    userInitiated: false,
    hasListeners: true,
    everConnected: false,
    attempt: 0,
  };

  it("does not reconnect after WhatsApp logged the session out", () => {
    // Credentials are wiped on logout; only a fresh QR scan can recover.
    expect(shouldReconnect({ ...base, loggedOut: true }).reconnect).toBe(false);
  });

  it("does not reconnect when the user pressed Disconnect", () => {
    expect(shouldReconnect({ ...base, userInitiated: true }).reconnect).toBe(false);
  });

  it("THE INCIDENT: does not reconnect a never-paired session nobody is watching", () => {
    const d = shouldReconnect({ ...base, hasListeners: false, everConnected: false });
    expect(d.reconnect).toBe(false);
    expect(d.reason).toBe("no_listeners");
  });

  it("keeps retrying while the user is actually watching the QR screen", () => {
    expect(shouldReconnect({ ...base, hasListeners: true }).reconnect).toBe(true);
  });

  it("gives up on pairing after a bounded number of attempts", () => {
    expect(
      shouldReconnect({ ...base, attempt: MAX_PAIRING_ATTEMPTS - 1 }).reconnect
    ).toBe(true);
    const exhausted = shouldReconnect({ ...base, attempt: MAX_PAIRING_ATTEMPTS });
    expect(exhausted.reconnect).toBe(false);
    expect(exhausted.reason).toBe("pairing_attempts_exhausted");
  });

  it("restores a previously-connected session even with nobody watching", () => {
    // Background sends depend on the socket being live, so an established
    // session must come back on its own after a transient network drop.
    const d = shouldReconnect({ ...base, hasListeners: false, everConnected: true });
    expect(d.reconnect).toBe(true);
  });

  it("does not apply the pairing attempt cap to an established session", () => {
    const d = shouldReconnect({
      ...base,
      hasListeners: false,
      everConnected: true,
      attempt: MAX_PAIRING_ATTEMPTS * 100,
    });
    expect(d.reconnect).toBe(true);
  });

  it("still stops an established session once it is logged out", () => {
    expect(
      shouldReconnect({ ...base, everConnected: true, loggedOut: true }).reconnect
    ).toBe(false);
  });

  it("always explains its decision", () => {
    for (const loggedOut of [true, false])
      for (const userInitiated of [true, false])
        for (const hasListeners of [true, false])
          for (const everConnected of [true, false])
            for (const attempt of [0, MAX_PAIRING_ATTEMPTS]) {
              const d = shouldReconnect({
                loggedOut,
                userInitiated,
                hasListeners,
                everConnected,
                attempt,
              });
              expect(typeof d.reason).toBe("string");
              expect(d.reason.length).toBeGreaterThan(0);
            }
  });
});
