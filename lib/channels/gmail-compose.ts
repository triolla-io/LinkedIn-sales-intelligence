/**
 * Gmail web-compose deep link: opens a pre-filled compose window in the user's
 * Gmail — nothing is sent until the user clicks Send there. Used by the
 * prepare-not-send review flows (company signals + fintech radar) instead of
 * sending through the Gmail API, so no extra OAuth scope is needed.
 *
 * Prisma-free by design — imported directly by client components.
 */
export function gmailComposeHref(to: string, body: string, subject?: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, body });
  if (subject && subject.trim()) params.set("su", subject);
  return `https://mail.google.com/mail/?${params.toString()}`;
}
