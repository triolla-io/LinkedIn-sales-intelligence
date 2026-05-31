import { humanPause, sleep } from "../human/timing";

export async function sendMessage(text: string): Promise<{ sentAt: string; conversationUrl: string }> {
  if (location.href.includes("/checkpoint/")) {
    throw withCode(new Error("LinkedIn checkpoint detected"), "checkpoint");
  }

  // Extract profile slug from current URL
  const slug = location.pathname.replace(/^\/in\//, "").replace(/\/$/, "");
  if (!slug) throw withCode(new Error("Cannot extract profile slug from URL"), "bad_payload");

  await humanPause(1500, 3000);

  // Get CSRF token (JSESSIONID cookie)
  const csrf = getCsrfToken();
  if (!csrf) throw withCode(new Error("No JSESSIONID cookie — not logged in?"), "checkpoint");

  const headers: Record<string, string> = {
    "csrf-token": csrf,
    "content-type": "application/json",
    "x-restli-protocol-version": "2.0.0",
  };

  // Step 1: Resolve profile slug → member URN
  const profileRes = await fetch(`/voyager/api/identity/profiles/${slug}`, {
    headers,
    credentials: "include",
  });
  if (!profileRes.ok) {
    throw withCode(new Error(`Profile lookup failed: ${profileRes.status}`), "not_messageable");
  }
  const profileData = await profileRes.json();
  const memberUrn: string | undefined =
    profileData?.data?.entityUrn ??
    profileData?.included?.[0]?.entityUrn;

  if (!memberUrn) {
    throw withCode(new Error("Could not find member URN in profile response"), "selector_missing");
  }

  await sleep(500);

  // Step 2: Send message via Voyager API
  const msgRes = await fetch("/voyager/api/messaging/conversations?action=create", {
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

  if (!msgRes.ok) {
    const errText = await msgRes.text().catch(() => "");
    throw withCode(new Error(`Voyager API send failed ${msgRes.status}: ${errText}`), "selector_missing");
  }

  const msgData = await msgRes.json();
  const conversationUrn: string =
    msgData?.value?.entityUrn ??
    msgData?.data?.entityUrn ??
    "";

  return {
    sentAt: new Date().toISOString(),
    conversationUrl: conversationUrn
      ? `https://www.linkedin.com/messaging/thread/${conversationUrn.split(":").pop()}/`
      : location.href,
  };
}

function getCsrfToken(): string | null {
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("JSESSIONID="));
  if (!match) return null;
  return match.split("=")[1].replace(/"/g, "");
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
