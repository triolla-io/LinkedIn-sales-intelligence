/**
 * Pure channel-availability + link builders for the Fintech Radar feed.
 *
 * No `@/lib/prisma` (or anything that transitively imports it) may be added
 * here — this file is imported directly by the client feed component, and a
 * prisma import in client-bundled code breaks `next build` (pg -> dns/fs/net).
 */
export type Channel = "email" | "linkedin" | "whatsapp";

export type ContactChannels = {
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
};

export function availableChannels(c: ContactChannels): Channel[] {
  const out: Channel[] = [];
  if (c.email && c.email.trim()) out.push("email");
  if (c.linkedinUrl && c.linkedinUrl.trim()) out.push("linkedin");
  if (c.phone && c.phone.trim()) out.push("whatsapp");
  return out;
}

export function channelHref(channel: Channel, c: ContactChannels, message: string): string {
  if (channel === "email") return `mailto:${c.email ?? ""}?body=${encodeURIComponent(message)}`;
  if (channel === "whatsapp") {
    const digits = (c.phone ?? "").replace(/\D/g, "");
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }
  return c.linkedinUrl ?? "";
}
