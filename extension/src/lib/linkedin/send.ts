import { humanPause, sleep } from "../human/timing";

export async function sendMessage(text: string): Promise<{ sentAt: string; conversationUrl: string }> {
  if (location.href.includes("/checkpoint/")) {
    throw withCode(new Error("LinkedIn checkpoint detected"), "checkpoint");
  }

  await humanPause(1500, 3000);

  const csrf = getCsrfToken();
  if (!csrf) throw withCode(new Error("No JSESSIONID — not logged in"), "checkpoint");

  // Get member URN — try page DOM first (most reliable), then API
  const memberUrn = getMemberUrnFromDOM() ?? await getMemberUrnFromAPI(csrf);
  if (!memberUrn) {
    throw withCode(new Error("Could not resolve member URN from page or API"), "not_messageable");
  }

  await sleep(500);

  const headers: Record<string, string> = {
    "csrf-token": csrf,
    "content-type": "application/json",
    "x-restli-protocol-version": "2.0.0",
    "accept": "application/vnd.linkedin.normalized+json+2.1",
  };

  // Try new API format first, fall back to legacy
  const sent = await trySendNewFormat(memberUrn, text, headers)
    ?? await trySendLegacyFormat(memberUrn, text, headers);

  if (!sent) {
    throw withCode(new Error("All messaging API attempts failed"), "selector_missing");
  }

  return { sentAt: new Date().toISOString(), conversationUrl: sent };
}

// ─── URN extraction ───────────────────────────────────────────────────────────

function getMemberUrnFromDOM(): string | null {
  const html = document.documentElement.innerHTML;
  for (const pattern of [
    /"entityUrn":"(urn:li:member:\d+)"/,
    /"objectUrn":"(urn:li:member:\d+)"/,
    /urn:li:member:(\d+)/,
  ]) {
    const m = html.match(pattern);
    if (m) return m[0].includes("urn:li:member:") ? `urn:li:member:${m[1]}` : m[1];
  }
  return null;
}

async function getMemberUrnFromAPI(csrf: string): Promise<string | null> {
  const slug = location.pathname.replace(/^\/in\//, "").replace(/\/$/, "");
  if (!slug) return null;
  try {
    const res = await fetch(`/voyager/api/identity/profiles/${slug}`, {
      headers: { "csrf-token": csrf, "x-restli-protocol-version": "2.0.0" },
      credentials: "include",
    });
    if (!res.ok) return null;
    const d = await res.json();
    return (
      d?.data?.objectUrn ??
      d?.data?.entityUrn ??
      d?.included?.find((x: Record<string, unknown>) =>
        typeof x?.objectUrn === "string" && (x.objectUrn as string).startsWith("urn:li:member:")
      )?.objectUrn ?? null
    );
  } catch {
    return null;
  }
}

// ─── Send attempts ────────────────────────────────────────────────────────────

async function trySendNewFormat(
  memberUrn: string,
  text: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const res = await fetch("/voyager/api/messaging/conversations?action=create", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        keyVersion: "LEGACY_INBOX",
        conversationCreate: {
          recipients: [memberUrn],
          subtype: "MEMBER_TO_MEMBER",
          eventCreate: {
            value: {
              "com.linkedin.voyager.messaging.create.MessageCreate": {
                attributedBody: { text, attributes: [] },
                attachments: [],
              },
            },
          },
        },
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.value?.entityUrn ?? d?.data?.entityUrn ?? "sent";
  } catch {
    return null;
  }
}

async function trySendLegacyFormat(
  memberUrn: string,
  text: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const res = await fetch("/voyager/api/messaging/conversations?action=create", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        keyVersion: "LEGACY_INBOX",
        conversationCreate: {
          recipients: [memberUrn],
          subtype: "MEMBER_TO_MEMBER",
          body: text,
        },
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.value?.entityUrn ?? d?.data?.entityUrn ?? "sent";
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCsrfToken(): string | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith("JSESSIONID="));
  return match ? match.split("=")[1].replace(/"/g, "") : null;
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
