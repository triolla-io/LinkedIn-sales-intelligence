import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret auth for the WhatsApp sidecar.
 *
 * The service is published on a public Coolify domain and had no auth on any
 * route, so an unauthenticated `POST /send` could message a linked user's
 * contacts as them. The app now sends `x-whatsapp-token` on every call.
 *
 * Rollout is deliberately fail-open when no secret is configured: the app and
 * the sidecar are separate Coolify resources with separate env, so enforcing a
 * secret that only one side has would take WhatsApp down again. Set
 * WHATSAPP_SERVICE_TOKEN on BOTH, then it is enforced.
 */

/** Routes reachable without a token. Coolify needs the healthcheck. */
export function isPublicPath(path: string): boolean {
  return path === "/health";
}

export function isAuthorized(
  expected: string | undefined,
  provided: string | undefined
): boolean {
  if (!expected) return true; // not configured yet — see note above
  if (!provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  // timingSafeEqual throws on length mismatch, and the lengths themselves are
  // not secret, so compare them first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
