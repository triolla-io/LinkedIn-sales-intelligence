import { readFileSync } from "fs";
import path from "path";

// Version of the extension build this deployment actually serves from
// /api/extension/download. Server-only (fs) — the pure comparison helpers that client
// components import live in ./version.ts.

let cached: string | null | undefined;

/**
 * Reads `extension/dist/manifest.json` from the app root — the same folder the download
 * route zips, so the reported version always matches the bytes a customer receives.
 * Cached for the process lifetime: dist is baked into the image at build time.
 * Returns null when dist is missing (e.g. an image built without the extension), which
 * makes the "outdated" check stay silent rather than guess.
 */
export function getServedExtensionVersion(): string | null {
  if (cached !== undefined) return cached;
  try {
    const manifestPath = path.join(process.cwd(), "extension", "dist", "manifest.json");
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
    cached = typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    cached = null;
  }
  return cached;
}
