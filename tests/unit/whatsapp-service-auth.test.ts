import { describe, it, expect } from "vitest";
import { isAuthorized, isPublicPath } from "../../whatsapp-service/src/auth";

// The sidecar is published on a public Coolify domain and had no auth on any
// route, so anyone who knew a userId could POST /send and message that user's
// WhatsApp contacts as them.

describe("isPublicPath", () => {
  it("leaves the healthcheck reachable so Coolify can probe it", () => {
    expect(isPublicPath("/health")).toBe(true);
  });

  it("protects every other route", () => {
    for (const p of ["/send", "/session/abc/qr", "/session/abc/status", "/session/abc/disconnect", "/"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("isAuthorized", () => {
  it("accepts a request carrying the exact token", () => {
    expect(isAuthorized("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(isAuthorized("s3cret", "wrong")).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(isAuthorized("s3cret", undefined)).toBe(false);
    expect(isAuthorized("s3cret", "")).toBe(false);
  });

  it("rejects a token that is merely a prefix of the real one", () => {
    expect(isAuthorized("s3cret", "s3c")).toBe(false);
    expect(isAuthorized("s3cret", "s3cretXX")).toBe(false);
  });

  it("stays open when no token is configured, so deploying cannot lock out the app", () => {
    // Staged rollout: the service must keep working until the shared secret is
    // set on BOTH the app and the sidecar, otherwise the deploy takes WhatsApp
    // down again.
    expect(isAuthorized(undefined, undefined)).toBe(true);
    expect(isAuthorized("", "anything")).toBe(true);
  });

  it("does not treat differing lengths as a crash", () => {
    expect(() => isAuthorized("short", "a-much-longer-token")).not.toThrow();
    expect(isAuthorized("short", "a-much-longer-token")).toBe(false);
  });
});
