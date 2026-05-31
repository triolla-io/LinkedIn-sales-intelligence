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
  // 1. Scan <code> elements (LinkedIn serializes page data there)
  for (const code of Array.from(document.querySelectorAll("code"))) {
    try {
      const str = code.textContent ?? "";
      const m = str.match(/"(?:entityUrn|objectUrn)":"(urn:li:member:\d+)"/);
      if (m) return m[1];
    } catch { /* skip */ }
  }

  // 2. Scan all <script> JSON blocks
  for (const script of Array.from(document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]'))) {
    const m = (script.textContent ?? "").match(/"(?:entityUrn|objectUrn)":"(urn:li:member:\d+)"/);
    if (m) return m[1];
  }

  // 3. Try utag_data analytics object (often has profile_member_id)
  try {
    const ud = (window as Record<string, unknown>).utag_data as Record<string, unknown> | undefined;
    if (ud) {
      const id = ud.profile_member_id ?? ud.memberID ?? ud.member_id;
      if (typeof id === "string" && /^\d+$/.test(id)) return `urn:li:member:${id}`;
    }
  } catch { /* skip */ }

  // 4. Fallback: scan full HTML
  const html = document.documentElement.innerHTML;
  const m = html.match(/"(?:entityUrn|objectUrn)":"(urn:li:member:\d+)"/);
  if (m) return m[1];

  return null;
}

async function getMemberUrnFromAPI(csrf: string): Promise<string | null> {
  const slug = location.pathname.replace(/^\/in\//, "").replace(/\/$/, "");
  if (!slug) return null;

  // Try multiple endpoints — LinkedIn deprecates them periodically
  const endpoints = [
    `/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${slug}`,
    `/voyager/api/identity/profiles/${slug}/profileView`,
    `/voyager/api/identity/profiles/${slug}/topCard`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: { "csrf-token": csrf, "x-restli-protocol-version": "2.0.0" },
        credentials: "include",
      });
      if (!res.ok) continue;
      const d = await res.json();
      const str = JSON.stringify(d);
      const m = str.match(/"(?:entityUrn|objectUrn)":"(urn:li:member:\d+)"/);
      if (m) return m[1];
    } catch { continue; }
  }

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
