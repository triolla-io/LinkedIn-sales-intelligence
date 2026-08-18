// Extension version comparison. Pure — imported by a client component, so it must stay
// free of fs / prisma (see the served-build reader in ./built-version.ts for the fs half).
//
// Why this exists: customers run the extension unpacked, so a fix does NOT reach them
// automatically. adi@triolla.io sat on 0.4.3 for four weeks while prod served 0.5.0, and
// the missing beforeunload fix wedged his whole send queue. The heartbeat already reports
// the installed version — this turns it into a visible "you are behind" signal.

const VERSION_RE = /^\d+(\.\d+)*$/;

function parse(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!VERSION_RE.test(trimmed)) return null;
  const parts = trimmed.split(".").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/**
 * Numeric dotted-version comparison: negative when `a` is older, positive when newer,
 * 0 when equal. Missing components count as 0 ("0.5" === "0.5.0"). Returns null when
 * either side isn't a dotted numeric version, so callers can stay silent instead of
 * guessing.
 */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * True only when we can prove the installed extension is older than the build the app
 * serves. Unknown on either side → false: a false "update your extension" banner costs
 * more trust than a missing one, and the connection badge already covers "never seen".
 */
export function isExtensionOutdated(
  installed: string | null | undefined,
  served: string | null | undefined,
): boolean {
  const cmp = compareVersions(installed, served);
  return cmp !== null && cmp < 0;
}
